// Heidi Mobile status — one truthful snapshot of HYDI for the phone.
//
// Two upstream checks, run in parallel:
//   /api/health         public liveness + system_dashboard verdict
//   /api/status/system  authenticated per-subsystem heartbeats (requireAuth)
// deriveConnectionState() collapses them into a single state. "online" is
// only ever reported when HYDI answered, accepted this device, returned a
// well-formed snapshot, and that snapshot says healthy — the page loading is
// never evidence of anything.

import { guard } from '../../../lib/heidi-mobile/guard.js';
import { normalizeHealth, normalizeSystemStatus, deriveConnectionState } from '../../../lib/heidi-mobile/normalize.js';

function describeError(source, result) {
  return { source, kind: result.kind, message: result.message, reason: result.reason };
}

export default async function handler(req, res) {
  const g = guard(req, res, { methods: ['GET'], routeName: 'status', rateMax: 30 });
  if (!g.ok) return;

  const started = Date.now();
  const [healthResult, systemResult] = await Promise.all([
    g.client.request('/api/health', { timeoutMs: 6000 }),
    g.client.request('/api/status/system', { timeoutMs: 8000 }),
  ]);

  const health = healthResult.ok ? normalizeHealth(healthResult.data) : null;
  const system = systemResult.ok ? normalizeSystemStatus(systemResult.data) : null;

  const errors = [];
  if (!healthResult.ok) errors.push(describeError('health', healthResult));
  else if (!health) errors.push({ source: 'health', kind: 'malformed', message: 'Health response had an unexpected shape' });
  if (!systemResult.ok) errors.push(describeError('system', systemResult));
  else if (!system) errors.push({ source: 'system', kind: 'malformed', message: 'Status snapshot had an unexpected shape' });

  const reachable = healthResult.ok || systemResult.ok
    || !['network', 'timeout', 'unconfigured'].includes(systemResult.kind);

  return res.status(200).json({
    state: deriveConnectionState(healthResult, systemResult, system),
    checked_at: new Date().toISOString(),
    latency_ms: Date.now() - started,
    api: { reachable, latency_ms: systemResult.latencyMs ?? null },
    device_id: g.session.deviceId,
    health,
    system,
    errors,
  });
}
