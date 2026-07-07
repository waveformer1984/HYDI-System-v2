/**
 * Standalone local smoke test for the Vercel-only top-level `/api` handlers.
 *
 * These files (api/health.js, api/ursula/status.js, api/mobile-status.js,
 * api/chat/route.js) are only served by Vercel's build/deploy system -- they
 * live outside `pages/`, so `next dev` never routes to them (confirmed: all
 * 404 under plain `npm run dev`). This script imports each handler function
 * directly and calls it with a mock Vercel req/res pair, so they can be
 * exercised locally without the Vercel CLI or a deployed project.
 *
 * Usage:
 *   node --import ./scripts/register-hook.mjs scripts/verify-vercel-api.mjs
 * (run from the repo root; the register-hook is what lets api/chat/route.js's
 * `../../lib/claude.js` import resolve to the real lib/claude.ts file)
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---- load .env.local / .env manually (no dotenv dependency needed) --------
for (const file of ['.env.local', '.env']) {
  const p = path.join(ROOT, file);
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      let value = m[2].trim();
      if (/^".*"$/.test(value)) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (_) { /* file optional */ }
}

// Only needed for this harness -- not present in .env.local, so the real
// checkServiceToken() in api/chat/route.js would otherwise 401 every call.
if (!process.env.HYDI_SERVICE_SECRET) {
  process.env.HYDI_SERVICE_SECRET = 'local-verify-harness-secret';
}

function mockRes() {
  const res = {
    _status: 200,
    _headers: {},
    _body: undefined,
    setHeader(k, v) { this._headers[k] = v; return this; },
    status(code) { this._status = code; return this; },
    json(obj) { this._body = obj; return this; },
    end(obj) { if (obj !== undefined) this._body = obj; return this; },
  };
  return res;
}

function mockReq({ method = 'GET', body, headers = {} } = {}) {
  return { method, body, headers, query: {} };
}

function buildServiceToken(service = 'verify-harness') {
  const secret = process.env.HYDI_SERVICE_SECRET;
  const ts = Date.now().toString();
  const requestId = randomUUID();
  const sig = createHmac('sha256', secret).update(`${ts}:${requestId}:${service}`).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

async function callGet(label, relPath) {
  const mod = await import(pathToFileURL(path.join(ROOT, relPath)).href);
  const res = mockRes();
  await mod.default(mockReq({ method: 'GET' }), res);
  console.log(`\n=== ${label} (${relPath}) ===`);
  console.log(`  status: ${res._status}`);
  console.log(`  body:   ${JSON.stringify(res._body)}`);
}

async function callChat(system, message) {
  const mod = await import(pathToFileURL(path.join(ROOT, 'api/chat/route.js')).href);
  const res = mockRes();
  const req = mockReq({
    method: 'POST',
    body: { message, system },
    headers: { 'x-hydi-service-token': buildServiceToken() },
  });
  await mod.default(req, res);
  console.log(`\n=== chat/route.js -> system:${system} ("${message}") ===`);
  console.log(`  status: ${res._status}`);
  console.log(`  body:   ${JSON.stringify(res._body)}`);
}

async function main() {
  await callGet('api/health.js', 'api/health.js');
  await callGet('api/ursula/status.js', 'api/ursula/status.js');
  await callGet('api/mobile-status.js', 'api/mobile-status.js');

  for (const [system, message] of [
    ['heidi', 'analyze current state'],
    ['ursula', 'system status'],
    ['cascade', 'status'],
    ['kilo', 'validate'],
    ['protoforge', 'status'],
    ['hyve', 'collective'],
  ]) {
    await callChat(system, message);
  }
}

main().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
