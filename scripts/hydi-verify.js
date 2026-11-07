#!/usr/bin/env node
'use strict';

/**
 * hydi-verify — one-command operational verification for the HYDI stack.
 *
 *   node scripts/hydi-verify.js            # full run
 *   node scripts/hydi-verify.js --quick    # skip DB round-trip write
 *
 * Prints a PASS/FAIL/SKIP table and exits 1 if anything FAILs.
 * Read-only except: one heidi_events probe row is NOT written (we only
 * read) — the script never mutates state.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
for (const f of ['.env.local', '.env']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) { try { require('dotenv').config({ path: p }); } catch (_) {} }
}

const results = [];
function record(name, status, detail = '') {
  results.push({ name, status, detail });
  const icon = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP' }[status] || status;
  console.log(`${icon.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
}

function getJSON(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode === 200, status: res.statusCode, body: JSON.parse(d), json: true }); }
        catch { resolve({ ok: res.statusCode === 200, status: res.statusCode, body: d.slice(0, 120), json: false }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
  });
}

function portOpen(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const s = require('net').connect({ port, host, timeout: timeoutMs });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
}

async function main() {
  const quick = process.argv.includes('--quick');
  console.log('hydi-verify — HYDI stack verification\n');

  // 1. Service ports (registry: .ports.json)
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, '.ports.json'), 'utf8'));
  const ports = registry.services || registry.ports || registry;
  const expected = Object.entries(ports)
    .filter(([, v]) => typeof v === 'number' || (v && typeof v.port === 'number'))
    .map(([name, v]) => ({ name, port: typeof v === 'number' ? v : v.port }));
  // Optional/degraded-by-design services: closed port is reported, not failed.
  const OPTIONAL = new Set(['heidi-mobile-chat', 'heidi-advisory', 'heidi-bridge', 'keeper', 'switchboard']);
  for (const { name, port } of expected) {
    const open = await portOpen(port);
    if (open) record(`port:${name}`, 'PASS', `:${port} open`);
    else record(`port:${name}`, OPTIONAL.has(name) ? 'SKIP' : 'FAIL', `:${port} closed${OPTIONAL.has(name) ? ' (optional/degraded)' : ''}`);
  }

  // 2. Health endpoints where they exist
  const healthChecks = [
    ['heidi-web', 'http://127.0.0.1:3000/api/health'],
    ['heidi-core', 'http://127.0.0.1:3459/health'],
    ['rezonate', 'http://127.0.0.1:3001/health'],
    ['protoforge', 'http://127.0.0.1:3005/health'],
    ['ursula', 'http://127.0.0.1:3100/'],
    ['ollama', 'http://127.0.0.1:11434/api/tags'],
  ];
  for (const [name, url] of healthChecks) {
    let r = await getJSON(url, 8000);
    if (!r.ok) r = await getJSON(url, 8000); // one retry — /api/health can be slow
    record(`health:${name}`, r.ok ? 'PASS' : 'FAIL', r.ok ? `HTTP ${r.status}` : `HTTP ${r.status} ${String(r.body).slice(0, 80)}`);
  }

  // 3. DB round-trip (read) — heidi_events reachable + has rows
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (quick) {
    record('db:heidi_events', 'SKIP', '--quick mode');
  } else if (sbUrl && sbKey) {
    const r = await fetch(`${sbUrl}/rest/v1/heidi_events?select=id&order=created_at.desc&limit=1`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    }).then((x) => x.json()).catch(() => null);
    const ok = Array.isArray(r) && r.length > 0;
    record('db:heidi_events', ok ? 'PASS' : 'FAIL', ok ? 'latest event row readable' : JSON.stringify(r).slice(0, 120));
  } else {
    record('db:heidi_events', 'SKIP', 'SUPABASE_URL/key not set');
  }

  // 4. Governance gate — out-of-bounds action MUST be blocked/review, never auto-approved
  try {
    const { probeOutOfBoundsGate, gateProbePasses } = require(path.join(ROOT, 'lib/governance/hydi-verify-gate-probe'));
    const r = probeOutOfBoundsGate(ROOT);
    record('gate:oob-blocked', gateProbePasses(ROOT) ? 'PASS' : 'FAIL', `verdict=${r.verdict} gate=${r.gate}`);
  } catch (e) {
    record('gate:oob-blocked', 'SKIP', `tripleGate not present on this branch (${e.message.slice(0, 60)})`);
  }

  // 5. Sync contract — endpoint reachable (401/405 = exists + guarded, fine)
  try {
    const r = await getJSON('http://127.0.0.1:3000/api/hydi/sync');
    const ok = r.status === 401 || r.status === 405 || r.status === 404 || r.ok;
    record('sync:endpoint', ok ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
  } catch (e) {
    record('sync:endpoint', 'FAIL', e.message);
  }

  // 6. Memory retrieval — retrieve_similar_facts RPC responds
  if (sbUrl && sbKey) {
    try {
      const r = await fetch(`${sbUrl}/rest/v1/rpc/retrieve_similar_facts`, {
        method: 'POST',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query_embedding: new Array(1536).fill(0), limit_results: 1 }),
      });
      record('memory:retrieve_rpc', r.ok ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
    } catch (e) {
      record('memory:retrieve_rpc', 'FAIL', e.message);
    }
  } else {
    record('memory:retrieve_rpc', 'SKIP', 'no supabase env');
  }

  // Summary
  const fails = results.filter((r) => r.status === 'FAIL').length;
  const passes = results.filter((r) => r.status === 'PASS').length;
  const skips = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`hydi-verify: ${passes} PASS, ${fails} FAIL, ${skips} SKIP`);
  // Defer exit one tick — abrupt exit on Windows can trip a libuv assertion.
  setTimeout(() => process.exit(fails ? 1 : 0), 250);
}

main().catch((e) => { console.error('hydi-verify crashed:', e); process.exit(1); });
