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
import { resolveBaseUrl } from '../../../lib/heidi-mobile/hydiClient.js';
import { normalizeHealth, normalizeSystemStatus, normalizeFrankHost, deriveConnectionState } from '../../../lib/heidi-mobile/normalize.js';

// CommonJS bridge for frank-observer evidence reader (same pattern as job-scout.js).
const { buildFrankHostHealth, applyFrankHostToConnectionState } = require('../../../lib/heidi-mobile/frank-host-health.js');

function describeError(source, result) {
  const row = { source, kind: result.kind, message: result.message, reason: result.reason };
  if (result.kind === 'unconfigured') {
    row.message = 'HYDI_API_URL is missing or not a valid http(s) URL. On Frank, leave it unset so the BFF talks to heidi-web on 127.0.0.1:3000, or set it to that same origin — not port 3006 (legacy mobile chat) or protoforge-core :3005.';
  } else if (result.kind === 'network' || result.kind === 'timeout') {
    row.message = `${result.message} The Heidi page loaded because heidi-web answered; this check failed when the BFF called HYDI at the configured upstream host.`;
  }
  return row;
}

function buildDiagnostics(session) {
  const base = resolveBaseUrl();
  let upstream_host = null;
  if (base) {
    try {
      upstream_host = new URL(base).host;
    } catch (_) {
      upstream_host = null;
    }
  }
  return {
    upstream_valid: Boolean(base),
    upstream_host,
    upstream_uses_default: !process.env.HYDI_API_URL,
    service_secret_configured: Boolean(process.env.HYDI_SERVICE_SECRET),
    device_pending_at_pairing: Boolean(session?.pending),
  };
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

  const frankRaw = buildFrankHostHealth({ root: process.cwd() });
  const frank_host = normalizeFrankHost(frankRaw);
  const baseState = deriveConnectionState(healthResult, systemResult, system);
  const state = applyFrankHostToConnectionState(baseState, frank_host);

  return res.status(200).json({
    state,
    checked_at: new Date().toISOString(),
    latency_ms: Date.now() - started,
    api: { reachable, latency_ms: systemResult.latencyMs ?? null },
    device_id: g.session.deviceId,
    health,
    system,
    frank_host,
    errors,
    diagnostics: buildDiagnostics(g.session),
  });
}
