// Heidi Mobile activity/briefing feed — HYDI's own notifications
// (lib/notifications/notify.js: worker failures, approvals required, task
// completions, security events). Read-only; nothing is summarised by a model,
// so the briefing can never contain a hallucinated event.

import { guard, sendUpstreamFailure } from '../../../lib/heidi-mobile/guard.js';
import { normalizeNotifications } from '../../../lib/heidi-mobile/normalize.js';

export default async function handler(req, res) {
  const g = guard(req, res, { methods: ['GET'], routeName: 'activity', rateMax: 30 });
  if (!g.ok) return;

  const result = await g.client.request('/api/notifications', { timeoutMs: 8000 });
  if (!result.ok) return sendUpstreamFailure(res, result);

  const notifications = normalizeNotifications(result.data);
  if (!notifications) return res.status(502).json({ error: 'malformed', message: 'Unexpected notifications response shape' });

  return res.status(200).json({
    checked_at: new Date().toISOString(),
    notifications,
    unread_count: notifications.filter((n) => !n.read).length,
  });
}
