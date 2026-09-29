// Heidi Mobile tasks — GET the approval queue + agent work, POST a decision.
//
// Reads:  /api/actions (ProtoForge-escalated actions awaiting a human),
//         /api/work-sessions (autonomous goals and their current step),
//         /api/agent-manager/control (recent worker commands + outcomes).
// Write:  /api/actions/:id { decision } — the same route the desktop
//         dashboard uses; HYDI re-checks RBAC ('actions:approve') and that the
//         action is genuinely awaiting approval before doing anything.
//
// Each section succeeds or fails independently so one broken table never
// blanks the whole screen, and a failed section is reported as failed, not
// as an empty list.

import { guard, sendUpstreamFailure } from '../../../lib/heidi-mobile/guard.js';
import {
  isUuid, normalizeApprovals, normalizeWorkSessions, normalizeCommands,
} from '../../../lib/heidi-mobile/normalize.js';

function section(result, normalize) {
  if (!result.ok) return { ok: false, error: { kind: result.kind, message: result.message, reason: result.reason } };
  const data = normalize(result.data);
  if (data === null) return { ok: false, error: { kind: 'malformed', message: 'Unexpected response shape' } };
  return { ok: true, data };
}

export default async function handler(req, res) {
  const g = guard(req, res, { methods: ['GET', 'POST'], routeName: `tasks-${req.method}`, rateMax: req.method === 'GET' ? 30 : 20 });
  if (!g.ok) return;

  if (req.method === 'GET') {
    const [approvals, work, commands] = await Promise.all([
      g.client.request('/api/actions', { timeoutMs: 8000 }),
      g.client.request('/api/work-sessions', { timeoutMs: 8000 }),
      g.client.request('/api/agent-manager/control', { timeoutMs: 8000 }),
    ]);
    return res.status(200).json({
      checked_at: new Date().toISOString(),
      approvals: section(approvals, normalizeApprovals),
      work: section(work, normalizeWorkSessions),
      commands: section(commands, normalizeCommands),
    });
  }

  const { id, decision } = req.body || {};
  if (!isUuid(id)) return res.status(400).json({ error: 'invalid_id', message: 'Task id must be a UUID.' });
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: 'invalid_decision', message: "decision must be 'approve' or 'reject'" });
  }

  // Approving executes the action, so allow it more time than a read.
  const result = await g.client.request(`/api/actions/${encodeURIComponent(id)}`, {
    method: 'POST', body: { decision }, timeoutMs: 30000,
  });
  if (!result.ok) return sendUpstreamFailure(res, result);

  const data = result.data || {};
  if (data.ok !== true) {
    return res.status(502).json({ error: 'malformed', message: 'HYDI did not confirm the decision.' });
  }
  // `result` (raw executor output) is intentionally not forwarded.
  return res.status(200).json({
    ok: true,
    id,
    decision,
    status: typeof data.status === 'string' ? data.status : null,
    error: typeof data.error === 'string' ? data.error.slice(0, 300) : null,
  });
}
