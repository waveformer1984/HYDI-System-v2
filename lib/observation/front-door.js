'use strict';

/**
 * Read-only front-door check: tailscale serve :443 → heidi-web :3000 and
 * /api/health answering through that mapping. Pure parsers + evaluators for tests.
 */

const TARGET_UPSTREAM = 'http://127.0.0.1:3000';

/**
 * @param {string} serveStatusText stdout of `tailscale serve status`
 * @returns {{ ok: boolean, mapped: boolean, target: string|null, detail?: string }}
 */
function parseTailscaleServeStatus(serveStatusText) {
  const text = String(serveStatusText || '');
  if (!text.trim()) {
    return { ok: false, mapped: false, target: null, detail: 'empty tailscale serve status' };
  }
  // Typical lines include https://... or |-- / proxy http://127.0.0.1:3000
  const lower = text.toLowerCase();
  const has443 = /\b443\b/.test(text) || lower.includes('https');
  const targetMatch = text.match(/127\.0\.0\.1:3000|localhost:3000/gi);
  const mapped = has443 && Boolean(targetMatch);
  return {
    ok: mapped,
    mapped,
    target: mapped ? TARGET_UPSTREAM : null,
    detail: mapped ? '443 serves heidi-web' : '443 is not mapped to 127.0.0.1:3000',
  };
}

/**
 * @param {{ serveStatusText?: string, healthProbe?: { ok: boolean, status?: number, error?: string } }} input
 */
function evaluateFrontDoor(input = {}) {
  const serve = parseTailscaleServeStatus(input.serveStatusText || '');
  const probe = input.healthProbe || { ok: false, error: 'not probed' };
  const healthy = Boolean(probe.ok && (probe.status === 200 || probe.status === undefined));
  const ok = serve.mapped && healthy;
  return {
    ok,
    serve,
    health: {
      ok: healthy,
      status: probe.status ?? null,
      error: probe.error || null,
    },
    level: ok ? 'OK' : !serve.mapped || !healthy ? 'CRIT' : 'WARN',
    proposedFix: {
      type: 'human',
      command: 'powershell -File scripts/tailscale/serve-heidi-web.ps1',
      risk: 'R2',
      wouldNeedApproval: true,
    },
  };
}

module.exports = { parseTailscaleServeStatus, evaluateFrontDoor, TARGET_UPSTREAM };
