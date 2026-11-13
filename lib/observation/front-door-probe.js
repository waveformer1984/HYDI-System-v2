'use strict';

/**
 * IO helpers for the front-door watchdog (invoked from fix-list-collector on Frank).
 * Read-only: tailscale serve status + local health fetch. Never runs serve-heidi-web.ps1.
 */

const { execFile } = require('child_process');
const http = require('http');

function runTailscaleServeStatus(execImpl = execFile) {
  return new Promise((resolve) => {
    const child = execImpl('tailscale', ['serve', 'status'], { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ text: '', error: String(stderr || err.message || 'tailscale serve status failed').slice(0, 200) });
        return;
      }
      resolve({ text: String(stdout || ''), error: null });
    });
    if (!child) resolve({ text: '', error: 'spawn failed' });
  });
}

function probeLocalHealth(url = 'http://127.0.0.1:3000/api/health', timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (out) => {
      if (settled) return;
      settled = true;
      resolve(out);
    };
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      finish({ ok: res.statusCode === 200, status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => finish({ ok: false, error: e && e.message ? e.message : 'error' }));
  });
}

/**
 * Health through tailscale's loopback HTTPS front door when MagicDNS is available.
 * Best-effort: falls back to direct :3000 only for the health leg when hostname unknown.
 */
async function probeFrontDoorHealth(hostname) {
  if (hostname && typeof hostname === 'string') {
    const url = `https://${hostname.replace(/\/+$/, '')}/api/health`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      return { ok: res.ok, status: res.status, via: 'tailscale-https' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'https probe failed', via: 'tailscale-https' };
    }
  }
  return { ok: false, error: 'front-door hostname unknown', via: 'skipped' };
}

/** First https://<host> in `tailscale serve status` output — the front door's own name. */
function serveHostname(serveStatusText) {
  const m = String(serveStatusText || '').match(/https:\/\/([a-z0-9.-]+\.ts\.net)\b/i);
  return m ? m[1] : null;
}

/**
 * The verdict's health leg is ONLY the probe through the Tailscale HTTPS
 * front door. A direct :3000 probe is collected as separate diagnostic
 * evidence (is heidi-web itself up?) and never stands in for the front
 * door: "heidi-web fine on :3000 but the tailnet URL broken" is exactly the
 * outage this watchdog exists to catch.
 */
async function collectFrontDoorEvidence({ execImpl, hostname, probeFront = probeFrontDoorHealth, probeDirect = probeLocalHealth } = {}) {
  const [serve, backendDirect] = await Promise.all([
    runTailscaleServeStatus(execImpl),
    probeDirect(),
  ]);
  const mapped = Boolean(serve.text && /127\.0\.0\.1:3000|localhost:3000/i.test(serve.text));
  const host = hostname || serveHostname(serve.text) || process.env.TS_CERT_DOMAIN || process.env.TAILSCALE_HOST || null;
  let healthProbe;
  if (!mapped) healthProbe = { ok: false, error: 'serve not mapped', via: 'skipped' };
  else if (!host) healthProbe = { ok: false, error: 'front-door hostname unknown', via: 'skipped' };
  else healthProbe = await probeFront(host);
  return { serveStatusText: serve.text, serveError: serve.error, healthProbe, backendDirect };
}

module.exports = {
  runTailscaleServeStatus,
  probeLocalHealth,
  probeFrontDoorHealth,
  collectFrontDoorEvidence,
  serveHostname,
};
