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
  isUuid, normalizeApprovals, normalizeWorkSessions, normalizeCommands, normalizeMissions,
} from '../../../lib/heidi-mobile/normalize.js';
import { listPendingMissions, decideMission } from '../../../lib/heidi-mobile/heidiCore.js';

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
    const [approvals, work, commands, missions] = await Promise.all([
      g.client.request('/api/actions', { timeoutMs: 8000 }),
      g.client.request('/api/work-sessions', { timeoutMs: 8000 }),
      g.client.request('/api/agent-manager/control', { timeoutMs: 8000 }),
      // heidi-core missions awaiting_approval — the governed task inbox
      // (pm2_restart / local_ci_rerun / disk_report proposals land here).
      listPendingMissions({ timeoutMs: 8000 }).then(
        (r) => ({ ok: r.ok, data: r.data, kind: r.ok ? null : 'upstream' }),
        () => ({ ok: false, kind: 'network', message: 'heidi-core unreachable' }),
      ),
    ]);
    return res.status(200).json({
      checked_at: new Date().toISOString(),
      approvals: section(approvals, normalizeApprovals),
      work: section(work, normalizeWorkSessions),
      commands: section(commands, normalizeCommands),
      missions: section(missions, normalizeMissions),
    });
  }

  const { id, decision, mission_id } = req.body || {};

  // Mission decisions go to heidi-core's existing lifecycle.decide — the
  // same approve/reject/cancel a person triggers from chat or mission-cli,
  // with the same human:<owner> actor and mission_events audit row. The
  // three execution gates are re-checked by the worker at run time.
  if (mission_id !== undefined && mission_id !== null) {
    const mid = Number(mission_id);
    if (!Number.isInteger(mid) || mid <= 0) {
      return res.status(400).json({ error: 'invalid_id', message: 'mission_id must be a positive integer.' });
    }
    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({ error: 'invalid_decision', message: "decision must be 'approve' or 'reject'" });
    }
    let mres;
    try {
      mres = await decideMission(mid, decision);
    } catch (e) {
      return res.status(502).json({ error: 'upstream', message: `heidi-core unreachable: ${e && e.message ? e.message : 'request failed'}`.slice(0, 300) });
    }
    if (!mres.ok) {
      return res.status(mres.status === 404 ? 404 : 502).json({
        error: 'upstream', message: `heidi-core decision failed (HTTP ${mres.status})`,
      });
    }
    const mdata = mres.data || {};
    if (mdata.ok !== true) {
      return res.status(409).json({ error: 'decision_refused', message: String(mdata.error || 'heidi-core refused the decision').slice(0, 300) });
    }
    return res.status(200).json({ ok: true, mission_id: mid, decision, status: mdata.mission && mdata.mission.status ? String(mdata.mission.status) : null });
  }

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
