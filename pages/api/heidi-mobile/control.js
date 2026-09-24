// Heidi Mobile control — queue a worker lifecycle command.
//
// This only forwards to HYDI's existing, authenticated command queue
// (api/agent-manager/control.js -> agent_control_commands ->
// workers/WorkerOrchestrator.js). Nothing executes here, HYDI re-checks the
// device's 'worker:control' permission, and every request is audit-logged
// upstream. Scaling commands are not exposed on the phone, and every command
// requires an explicit `confirm: true` set by the UI's confirmation step.

import { guard, sendUpstreamFailure } from '../../../lib/heidi-mobile/guard.js';
import { isIdent } from '../../../lib/heidi-mobile/normalize.js';

const PHONE_COMMANDS = new Set(['start', 'restart', 'stop']);

export default async function handler(req, res) {
  const g = guard(req, res, { methods: ['POST'], routeName: 'control', rateMax: 10 });
  if (!g.ok) return;

  const { worker_type: workerType, worker_id: workerId, command, confirm } = req.body || {};
  if (!PHONE_COMMANDS.has(command)) {
    return res.status(400).json({ error: 'invalid_command', message: 'command must be start, restart or stop' });
  }
  if (!isIdent(workerType)) return res.status(400).json({ error: 'invalid_worker', message: 'worker_type is required' });
  if (workerId != null && !isIdent(workerId)) return res.status(400).json({ error: 'invalid_worker', message: 'worker_id is malformed' });
  if (confirm !== true) {
    return res.status(400).json({ error: 'confirmation_required', message: 'Confirm the command before it is queued.' });
  }

  const result = await g.client.request('/api/agent-manager/control', {
    method: 'POST',
    body: { worker_type: workerType, worker_id: workerId || null, command, payload: { source: 'heidi-mobile' } },
    timeoutMs: 10000,
  });
  if (!result.ok) return sendUpstreamFailure(res, result);

  const cmd = result.data && result.data.command;
  if (!cmd || typeof cmd !== 'object' || !cmd.id) {
    return res.status(502).json({ error: 'malformed', message: 'HYDI did not confirm the queued command.' });
  }
  return res.status(202).json({
    queued: true,
    command: { id: String(cmd.id), command: cmd.command, worker_type: cmd.worker_type, status: cmd.status },
  });
}
