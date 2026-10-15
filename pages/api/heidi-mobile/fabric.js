// Heidi Mobile BFF — execution fabric (capabilities, tasks, readiness).

import { guard, sendUpstreamFailure } from '../../../lib/heidi-mobile/guard.js';

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
  if (req.query?.task_id) q.set('task_id', String(req.query.task_id));
  if (req.query?.history) q.set('history', '1');
  if (req.query?.limit) q.set('limit', String(req.query.limit));

  const path = q.toString() ? `/api/mobile-ops/fabric?${q}` : '/api/mobile-ops/fabric';

  if (req.method === 'GET') {
    const result = await g.client.request(path, { method: 'GET', timeoutMs: 15000 });
    if (!result.ok) return sendUpstreamFailure(res, result);
    return res.status(200).json(result.data);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const headers = {};
  if (typeof req.headers['x-idempotency-key'] === 'string') {
    headers['x-idempotency-key'] = req.headers['x-idempotency-key'];
  }

  const result = await g.client.request('/api/mobile-ops/fabric', {
    method: 'POST',
    body,
    headers,
    timeoutMs: body.capability === 'tests.run' || body.action === 'tests.run' ? 130_000 : 30_000,
  });
  if (!result.ok) return sendUpstreamFailure(res, result);
  return res.status(200).json(result.data);
}
