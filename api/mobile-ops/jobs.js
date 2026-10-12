// Mobile-ops jobs — long-running allowlisted builds and test suites with live
// output, cancel and reconnect-safe log paging (lib/mobile-ops/job-manager.js).
//
//   GET  /api/mobile-ops/jobs                 → { catalog, jobs }
//   GET  /api/mobile-ops/jobs?id=..&since=N   → { job, lines, next_since, gap, more }
//   POST /api/mobile-ops/jobs { kind, args?, confirm? }   → start
//   POST /api/mobile-ops/jobs { id, cancel: true }        → cancel
//
// Auth: device or service token (requireAuth). Each job kind has its own
// permission (ops:run_tests, ops:build). Every start/cancel is audit-logged.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { getJobManager } from '../../lib/mobile-ops/job-manager.js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

const ID_RE = /^[a-f0-9]{16}$/;

/**
 * @param {object} deps
 * @param {(req, res, routeName) => Promise<{ok: boolean, role?: string, deviceId?: string}>} deps.authenticate
 * @param {() => import('../../lib/mobile-ops/job-manager.js').JobManager} deps.manager
 * @param {(event: object) => Promise<void>} deps.audit
 */
export function createJobsHandler({ authenticate, manager, audit }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await authenticate(req, res, req.method === 'GET' ? 'mobile-ops-jobs-read' : 'mobile-ops-jobs-write');
    if (!auth.ok) return;
    const jm = manager();

    if (req.method === 'GET') {
      const id = typeof req.query?.id === 'string' ? req.query.id : null;
      if (!id) return res.status(200).json({ catalog: jm.catalogFor(auth.role), jobs: jm.list({ role: auth.role }) });
      if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' });
      const out = jm.get({ id, since: Number(req.query.since || 0), role: auth.role, limit: 500 });
      if (!out.ok) return res.status(out.error === 'not_found' ? 404 : 403).json(out);
      return res.status(200).json(out);
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.cancel === true) {
      if (typeof body.id !== 'string' || !ID_RE.test(body.id)) return res.status(400).json({ error: 'invalid_id' });
      const out = jm.cancel({ id: body.id, role: auth.role });
      await audit({ event_type: out.ok ? 'mobile_ops_job_cancel' : 'mobile_ops_job_cancel_failed', device_id: auth.deviceId || null, role: auth.role, reason: out.error || body.id, metadata: { job_id: body.id } });
      if (!out.ok) return res.status(out.error === 'not_found' ? 404 : 403).json(out);
      return res.status(200).json(out);
    }

    const out = jm.start({ kind: body.kind, args: body.args, confirm: body.confirm === true, role: auth.role, actor: auth.deviceId || auth.role });
    await audit({
      event_type: out.ok ? 'mobile_ops_job_start' : 'mobile_ops_job_rejected',
      device_id: auth.deviceId || null,
      role: auth.role,
      reason: out.ok ? body.kind : out.error,
      metadata: { kind: typeof body.kind === 'string' ? body.kind.slice(0, 64) : null, job_id: out.ok ? out.job.id : null },
    });
    if (!out.ok) {
      const code = out.error === 'forbidden' ? 403 : out.error === 'busy' ? 409 : 400;
      return res.status(code).json(out);
    }
    return res.status(202).json(out);
  };
}

export default createJobsHandler({
  authenticate: (req, res, routeName) => requireAuth(req, res, supabase, { permission: 'status:view', routeName }),
  manager: getJobManager,
  audit: (event) => supabase.from('auth_audit_log').insert(event).then(undefined, () => {}),
});
