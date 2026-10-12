// Heidi Mobile typed ops — forwards to HYDI's allowlisted /api/mobile-ops/run gateway.
// Read-only actions need no confirm; tests.run requires confirm: true from the UI.

import { guard, sendUpstreamFailure } from '../../../lib/heidi-mobile/guard.js';
import { isKnownAction } from '../../../lib/mobile-ops/action-catalog.js';

export default async function handler(req, res) {
  const g = guard(req, res, {
    methods: ['GET', 'POST'],
    routeName: 'ops',
    rateMax: req.method === 'POST' ? 15 : 30,
  });
  if (!g.ok) return;

  if (req.method === 'GET') {
    const result = await g.client.request('/api/mobile-ops/run', { method: 'GET', timeoutMs: 10000 });
    if (!result.ok) return sendUpstreamFailure(res, result);
    return res.status(200).json(result.data);
  }

  const { action, args, confirm } = req.body || {};
  if (!isKnownAction(action)) {
    return res.status(400).json({ error: 'invalid_action', message: 'action must be a known typed ops id' });
  }
  if (action === 'tests.run' && confirm !== true) {
    return res.status(400).json({ error: 'confirmation_required', message: 'Confirm before running tests on the HYDI host.' });
  }

  const result = await g.client.request('/api/mobile-ops/run', {
    method: 'POST',
    body: { action, args: args && typeof args === 'object' ? args : {}, confirm: confirm === true },
    timeoutMs: action === 'tests.run' ? 130_000 : 15_000,
  });
  if (!result.ok) return sendUpstreamFailure(res, result);
  return res.status(result.data && result.data.ok === false ? 502 : 200).json(result.data);
}
