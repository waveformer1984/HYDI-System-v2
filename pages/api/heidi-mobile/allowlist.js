// Heidi Mobile allowlist — the three phone-approvable actions.
// GET  -> specs Jordan can propose (pm2_restart, local_ci_rerun, disk_report)
// POST -> propose one; it becomes a mission in awaiting_approval (Tasks tab).
// Nothing executes here — approval and the HEIDI_ALLOW_EXEC/bounds gates
// live in heidi-core's mission worker.

import { guard } from '../../../lib/heidi-mobile/guard.js';

const CORE_URL = () => String(process.env.HEIDI_CORE_URL || 'http://127.0.0.1:3459').replace(/\/+$/, '');

async function upstream(path, init = {}) {
  const res = await fetch(`${CORE_URL()}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export default async function handler(req, res) {
  const g = guard(req, res, { methods: ['GET', 'POST'], routeName: 'allowlist', rateMax: 20 });
  if (!g.ok) return;

  try {
    if (req.method === 'GET') {
      const r = await upstream('/allowlist');
      if (r.status !== 200) return res.status(502).json({ error: 'upstream', message: `heidi-core answered ${r.status}` });
      return res.status(200).json(r.data);
    }
    const { spec, args } = req.body || {};
    if (typeof spec !== 'string' || !spec) return res.status(400).json({ error: 'spec required' });
    const r = await upstream('/allowlist/propose', { method: 'POST', body: JSON.stringify({ spec, args: args || {} }) });
    return res.status(r.status === 200 ? 200 : r.status === 400 ? 400 : 502).json(r.data);
  } catch (e) {
    return res.status(502).json({ error: 'unreachable', message: e && e.message ? e.message : 'heidi-core unreachable' });
  }
}
