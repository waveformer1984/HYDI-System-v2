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
  return probeLocalHealth();
}

async function collectFrontDoorEvidence({ execImpl, hostname } = {}) {
  const [serve, healthDirect] = await Promise.all([
    runTailscaleServeStatus(execImpl),
    probeLocalHealth(),
  ]);
  const healthViaServe = serve.text && serve.text.includes('127.0.0.1:3000')
    ? await probeFrontDoorHealth(hostname || process.env.TS_CERT_DOMAIN || process.env.TAILSCALE_HOST)
    : { ok: false, error: 'serve not mapped', via: 'skipped' };
  const healthProbe = healthViaServe.ok ? healthViaServe : healthDirect;
  return { serveStatusText: serve.text, serveError: serve.error, healthProbe };
}

module.exports = {
  runTailscaleServeStatus,
  probeLocalHealth,
  probeFrontDoorHealth,
  collectFrontDoorEvidence,
};
