// Heidi Mobile jobs — relays HYDI's allowlisted long-running jobs
// (/api/mobile-ops/jobs): start, follow output by cursor, cancel.
// Input is validated here too, so junk never reaches HYDI.

import { guard, sendUpstreamFailure } from '../../../lib/heidi-mobile/guard.js';
import { isKnownJob, JOBS } from '../../../lib/mobile-ops/job-catalog.js';

const ID_RE = /^[a-f0-9]{16}$/;
const SUITE_RE = /^[a-z0-9-]{1,40}$/;

export default async function handler(req, res) {
  const g = guard(req, res, {
    methods: ['GET', 'POST'],
    routeName: 'jobs',
    // Log polling runs about once a second while a job is open.
    rateMax: req.method === 'POST' ? 10 : 120,
  });
  if (!g.ok) return;

  if (req.method === 'GET') {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    let path = '/api/mobile-ops/jobs';
    if (id) {
      if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' });
      const since = Math.max(0, Math.floor(Number(req.query.since) || 0));
      path += `?id=${id}&since=${since}`;
    }
    const result = await g.client.request(path, { method: 'GET', timeoutMs: 10000 });
    if (!result.ok) return sendUpstreamFailure(res, result);
    return res.status(200).json(result.data);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let upstream;
  if (body.cancel === true) {
    if (typeof body.id !== 'string' || !ID_RE.test(body.id)) return res.status(400).json({ error: 'invalid_id' });
    upstream = { id: body.id, cancel: true };
  } else {
    if (!isKnownJob(body.kind)) return res.status(400).json({ error: 'invalid_job', message: 'kind must be a known job id' });
    if (JOBS[body.kind].confirmRequired && body.confirm !== true) {
      return res.status(400).json({ error: 'confirmation_required', message: 'Confirm before starting this job on the HYDI host.' });
    }
    const args = {};
    if (body.args && typeof body.args.suite === 'string') {
      if (!SUITE_RE.test(body.args.suite)) return res.status(400).json({ error: 'invalid_args' });
      args.suite = body.args.suite;
    }
    upstream = { kind: body.kind, args, confirm: body.confirm === true };
  }

  const result = await g.client.request('/api/mobile-ops/jobs', { method: 'POST', body: upstream, timeoutMs: 15000 });
  if (!result.ok) return sendUpstreamFailure(res, result);
  return res.status(result.status || 200).json(result.data);
}
