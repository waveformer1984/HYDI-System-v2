#!/usr/bin/env node
'use strict';
/**
 * HYDI Watchdog
 * ----------------------------------------------------------------------------
 * Independently polls the health endpoints of the three boot-managed HTTP
 * services and logs results. On any failure, writes a timestamped entry to
 * logs/watchdog.log and (optionally) POSTs an alert to WATCHDOG_WEBHOOK_URL.
 *
 * Two modes:
 *   node scripts/watchdog.js          # long-running, polls every 2 minutes
 *   node scripts/watchdog.js --once   # single check, then exit
 *
 * The --once mode is suitable for a Windows Scheduled Task that runs every
 * 2 minutes. The long-running mode is suitable for PM2.
 *
 * Environment:
 *   WATCHDOG_WEBHOOK_URL  (optional) — if set, POSTs JSON alerts on failures
 *   WATCHDOG_INTERVAL_MS  (optional) — poll interval, default 120000 (2 min)
 *
 * Log file: logs/watchdog.log (created automatically)
 * ---------------------------------------------------------------------------
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.resolve(ROOT, 'logs');
const LOG_FILE = path.resolve(LOG_DIR, 'watchdog.log');

const ENDPOINTS = [
  { name: 'protoforge-core',    url: 'http://127.0.0.1:3005/health' },
  { name: 'heidi-web',          url: 'http://127.0.0.1:3000/api/health' },
  { name: 'heidi-mobile-chat',  url: 'http://127.0.0.1:3006/api/health' },
];

const INTERVAL_MS = parseInt(process.env.WATCHDOG_INTERVAL_MS || '120000', 10);
const WEBHOOK_URL = process.env.WATCHDOG_WEBHOOK_URL || '';
const ONCE = process.argv.includes('--once');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(line) {
  const ts = new Date().toISOString();
  const entry = `${ts} ${line}`;
  console.log(entry);
  ensureLogDir();
  fs.appendFileSync(LOG_FILE, entry + '\n');
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
function checkEndpoint(ep) {
  return new Promise((resolve) => {
    const url = new URL(ep.url);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(ep.url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          name: ep.name,
          url: ep.url,
          ok: res.statusCode >= 200 && res.statusCode < 500,
          statusCode: res.statusCode,
          body: body.slice(0, 200),
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ name: ep.name, url: ep.url, ok: false, statusCode: 0, body: 'timeout' });
    });
    req.on('error', (e) => {
      resolve({ name: ep.name, url: ep.url, ok: false, statusCode: 0, body: e.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Webhook alert
// ---------------------------------------------------------------------------
function sendWebhook(failures) {
  if (!WEBHOOK_URL) return;
  const payload = JSON.stringify({
    text: `HYDI Watchdog: ${failures.length} endpoint(s) down`,
    failures: failures.map((f) => ({ name: f.name, url: f.url, status: f.statusCode, error: f.body })),
    timestamp: new Date().toISOString(),
  });
  const url = new URL(WEBHOOK_URL);
  const lib = url.protocol === 'https:' ? https : http;
  const req = lib.request(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 10000,
  }, (res) => { res.resume(); });
  req.on('error', () => { /* swallow — webhook is best-effort */ });
  req.on('timeout', () => { req.destroy(); });
  req.write(payload);
  req.end();
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------
async function runCheck() {
  const results = await Promise.all(ENDPOINTS.map(checkEndpoint));
  const failures = results.filter((r) => !r.ok);
  const allOk = failures.length === 0;

  if (allOk) {
    const names = results.map((r) => `${r.name}:${r.statusCode}`).join('  ');
    log(`OK    all 3 endpoints healthy  ${names}`);
  } else {
    for (const f of failures) {
      log(`FAIL  ${f.name}  ${f.url}  status=${f.statusCode}  error=${f.body}`);
    }
    const okNames = results.filter((r) => r.ok).map((r) => r.name).join(',');
    log(`ALERT ${failures.length}/${results.length} endpoints down (ok: ${okNames || 'none'})`);
    sendWebhook(failures);
  }
  return allOk;
}

async function main() {
  log(`watchdog started (mode=${ONCE ? 'once' : 'continuous'}, interval=${INTERVAL_MS}ms, webhook=${WEBHOOK_URL ? 'on' : 'off'})`);

  if (ONCE) {
    const ok = await runCheck();
    process.exit(ok ? 0 : 1);
  }

  // Continuous mode
  await runCheck();
  setInterval(runCheck, INTERVAL_MS);

  // Keep the process alive
  process.on('SIGINT', () => { log('watchdog stopped'); process.exit(0); });
  process.on('SIGTERM', () => { log('watchdog stopped'); process.exit(0); });
}

main().catch((e) => {
  log(`watchdog error: ${e.message}`);
  process.exit(1);
});
