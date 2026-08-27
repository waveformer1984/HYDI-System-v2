// Test Push Notification
// POST /api/operations/test-push
//
// Fires a real VAPID web-push notification to all subscribed devices.
// Used to verify the push channel is working end-to-end.
//
// Auth: requires revenue:manage permission (same as other operations endpoints).

import { getEscalationNotifier } from '../../../lib/operational/EscalationNotifier';
import { requireAuth } from '../../../lib/auth/requireAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res, supabase, {
    permission: 'revenue:manage',
    routeName: 'test-push',
  });
  if (!auth.ok) return;

  const notifier = getEscalationNotifier(supabase);

  try {
    const result = await notifier.sendTest();
    return res.status(200).json({
      success: result.sent,
      channels: result.channels,
      error: result.error,
      message: result.sent
        ? `Test notification sent via: ${result.channels.join(', ')}`
        : `Test notification failed: ${result.error || 'No channels available'}`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: msg });
  }
}
