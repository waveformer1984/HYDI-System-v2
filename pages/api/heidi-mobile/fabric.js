// Heidi Mobile BFF — execution fabric (capabilities, tasks, readiness).
// Relays task-bearing upstream bodies so a failed verification is visible.
// Device pairing authenticates the phone; it does not supply a billing tenant.

import { guard, sendUpstreamFailure } from '../../../lib/heidi-mobile/guard.js';
import { redactSensitive } from '../../../lib/execution-fabric/access.js';

const TASK_STATUSES = new Set([200, 202, 400, 403, 404, 409, 502]);

function clientBody(raw) {
  const body = raw && typeof raw === 'object' ? { ...raw } : {};
  delete body.tenant_id;
  delete body.principal;
  delete body.role;
  return body;
}

async function relay(res, client, path, init) {
  const upstream = await client.raw(path, init);
  if (!upstream.ok) return sendUpstreamFailure(res, upstream);
  let text = '';
  try {
    text = await upstream.response.text();
  } catch (_) {
    upstream.release();
    return sendUpstreamFailure(res, { kind: 'network', message: 'HYDI connection dropped mid-response' });
  }
  upstream.release();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    return sendUpstreamFailure(res, { kind: 'malformed', message: 'HYDI returned a response that is not valid JSON' });
  }
  if (!data || typeof data !== 'object') {
    return sendUpstreamFailure(res, { kind: 'malformed', message: 'HYDI returned an empty response' });
  }
  const status = upstream.response.status;
  const safe = redactSensitive(data);
  if (status === 502 && safe.task) {
    return res.status(200).json({ ...safe, upstream_status: 502 });
  }
  if (!TASK_STATUSES.has(status)) {
    return sendUpstreamFailure(res, {
      kind: status === 401 ? 'unauthorized' : status === 429 ? 'rate_limited' : status >= 500 ? 'server' : 'client',
      status,
      message: typeof safe.message === 'string' ? safe.message : typeof safe.error === 'string' ? safe.error : `HYDI returned HTTP ${status}`,
    });
  }
  if (status !== 200 && status !== 202) {
    return res.status(status).json({ ...safe, upstream_status: status });
  }
  return res.status(status).json(safe);
}

export default async function handler(req, res) {
  const g = guard(req, res, {
    methods: ['GET', 'POST'],
    routeName: 'fabric',
    rateMax: req.method === 'POST' ? 20 : 40,
  });
  if (!g.ok) return;

  const q = new URLSearchParams();
  if (req.query?.readiness) q.set('readiness', '1');
  if (req.query?.recovery) q.set('recovery', '1');
  if (req.query?.operational) q.set('operational', '1');
  if (req.query?.task_id) q.set('task_id', String(req.query.task_id));
  if (req.query?.history) q.set('history', '1');
  if (req.query?.limit) q.set('limit', String(req.query.limit));

  const path = q.toString() ? `/api/mobile-ops/fabric?${q}` : '/api/mobile-ops/fabric';

  if (req.method === 'GET') {
    return relay(res, g.client, path, { method: 'GET', timeoutMs: 15000 });
  }

  const body = clientBody(req.body);
  const extraHeaders = {};
  if (typeof req.headers['x-idempotency-key'] === 'string') {
    extraHeaders['x-idempotency-key'] = req.headers['x-idempotency-key'].slice(0, 128);
  }
  const slow = body.capability === 'tests.run' || body.action === 'tests.run' || body.capability_id === 'tests.run';
  return relay(res, g.client, '/api/mobile-ops/fabric', {
    method: 'POST',
    body,
    extraHeaders,
    timeoutMs: slow ? 130_000 : 30_000,
  });
}
