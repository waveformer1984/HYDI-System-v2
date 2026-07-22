'use strict';

/**
 * Phase 3 — notification framework. Delivery rides the existing
 * push_subscriptions table (VAPID web-push, already migrated in
 * 20260623120000_push_subscriptions.sql — nothing sent through it before
 * this file, per the mobile-ops recon). Degrades gracefully when
 * VAPID keys aren't configured (same pattern as lib/embeddings.ts for a
 * missing provider): the notification row is still created and readable
 * in-app, it just isn't pushed to a device.
 */

let webpush = null;
try {
  webpush = require('web-push');
} catch (_) {
  webpush = null;
}

const { publish } = require('../realtime/eventBus');

let vapidConfigured = false;
function configureVapid() {
  if (vapidConfigured || !webpush) return vapidConfigured;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:ops@hydi.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

const CATEGORIES = [
  'worker_failure', 'security_event', 'deployment_failure', 'agent_crash',
  'task_completed', 'document_generated', 'build_completed', 'deployment_completed',
  'approval_required', 'destructive_action_confirmation',
];

const SEVERITY_BY_CATEGORY = {
  worker_failure: 'critical', security_event: 'critical', deployment_failure: 'critical', agent_crash: 'critical',
  task_completed: 'operational', document_generated: 'operational', build_completed: 'operational', deployment_completed: 'operational',
  approval_required: 'approval', destructive_action_confirmation: 'approval',
};

/**
 * Create a notification row and best-effort push it to subscribed devices.
 * @param {object} supabase
 * @param {{category: string, title: string, body?: string, device_id?: string, metadata?: object}} input
 */
async function createNotification(supabase, input) {
  const { category, title, body, device_id, metadata } = input;
  if (!CATEGORIES.includes(category)) throw new Error(`unknown notification category: ${category}`);
  if (!title) throw new Error('title is required');

  const severity = SEVERITY_BY_CATEGORY[category] || 'info';

  const { data: notification, error } = await supabase
    .from('notifications')
    .insert({ category, severity, title, body: body || null, device_id: device_id || null, metadata: metadata || {} })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Same-process convenience: instant push to any SSE client attached to
  // this Node process, without waiting on the Realtime round trip that
  // api/events/stream.js's cross-process bridge also picks this row up
  // through (see that file). A client connected there may see the
  // `notification` event twice for one row — harmless, since the listener
  // just re-fetches the notification list (tests/unit/notifications-api).
  publish('notification', {
    id: notification.id, category, severity, title, body: body || null, device_id: device_id || null,
  });

  const delivered = await deliverPush(supabase, notification);
  if (delivered) {
    await supabase.from('notifications').update({ delivered_at: new Date().toISOString() }).eq('id', notification.id);
  }

  return notification;
}

/** Respects per-device category preferences; broadcasts to every active subscription when no device_id is set. */
async function deliverPush(supabase, notification) {
  let query = supabase.from('push_subscriptions').select('*').eq('active', true);
  if (notification.device_id) query = query.eq('device_id', notification.device_id);
  const { data: subs } = await query;
  if (!subs || subs.length === 0) return false;

  const enabledSubs = [];
  for (const sub of subs) {
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('categories')
      .eq('device_id', sub.device_id)
      .maybeSingle();
    const enabled = !prefs || prefs.categories?.[notification.category] !== false;
    if (enabled) enabledSubs.push(sub);
  }
  if (enabledSubs.length === 0) return false;

  if (!configureVapid()) {
    return false; // graceful degradation: notification exists, just isn't pushed
  }

  const payload = JSON.stringify({
    title: notification.title, body: notification.body, category: notification.category, severity: notification.severity,
  });

  const results = await Promise.allSettled(
    enabledSubs.map((sub) => webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    )),
  );

  return results.some((r) => r.status === 'fulfilled');
}

module.exports = { createNotification, deliverPush, CATEGORIES, SEVERITY_BY_CATEGORY, configureVapid };
