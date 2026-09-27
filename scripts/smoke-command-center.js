#!/usr/bin/env node
'use strict';
/**
 * Command Center latency smoke test — the regression guard for the
 * "degraded PostgREST hangs chat for ~90s" incident.
 *
 * Asserts that the user-facing paths stay fast even when the Supabase
 * REST layer is degraded, because they either bypass it (direct pg) or
 * carry a hard transport timeout (lib/supabase-timed.ts).
 *
 * Usage: node scripts/smoke-command-center.js [--port 3010]
 * Exit 0 = all checks pass, exit 1 = any check fails or times out.
 */
const http = require('http');

const PORT = Number(process.argv.find(a => a.startsWith('--port'))?.split('=')[1]
  ?? process.argv[process.argv.indexOf('--port') + 1]
  ?? process.env.PORT ?? 3000);
const BASE = `http://127.0.0.1:${PORT}`;
const BUDGET_MS = Number(process.env.SMOKE_BUDGET_MS ?? 5000);
// The Heidi path includes local-LLM inference (Ollama on CPU ~10-60s
// honest work); the hard assertion is that it BOUNDS, not that it's
// fast — Supabase degradation used to add minutes on top of that.
const HEIDI_BUDGET_MS = Number(process.env.SMOKE_HEIDI_BUDGET_MS ?? 65000);
const STATE_BUDGET_MS = Number(process.env.SMOKE_STATE_BUDGET_MS ?? 15000);

function timed(req) {
  const t0 = Date.now();
  return req.then(r => ({ ...r, ms: Date.now() - t0 }))
    .catch(e => ({ ok: false, error: String(e), ms: Date.now() - t0 }));
}

function get(path, timeoutMs) {
  return timed(new Promise((resolve, reject) => {
    const rq = http.get(`${BASE}${path}`, { timeout: timeoutMs }, (res) => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: b }));
    });
    rq.on('timeout', () => { rq.destroy(); reject(new Error(`timeout ${timeoutMs}ms`)); });
    rq.on('error', reject);
  }));
}

function post(path, body, timeoutMs) {
  return timed(new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const rq = http.request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      timeout: timeoutMs,
    }, (res) => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: b }));
    });
    rq.on('timeout', () => { rq.destroy(); reject(new Error(`timeout ${timeoutMs}ms`)); });
    rq.on('error', reject);
    rq.end(data);
  }));
}

async function supabaseRestMs() {
  const t0 = Date.now();
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
    await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, { signal: AbortSignal.timeout(3000) });
    return Date.now() - t0;
  } catch { return -1; }
}

(async () => {
  console.log(`smoke: command-center  base=${BASE}  budget=${BUDGET_MS}ms`);
  let failures = 0;

  // 1. workspace state — must include the agents section (pg-backed)
  const state = await get('/api/workspace/state', STATE_BUDGET_MS + 5000);
  let stateMs = state.ms;
  if (!state.ok) { console.log(`✗ /api/workspace/state → ${state.error ?? state.status} in ${stateMs}ms`); failures++; }
  else {
    const j = JSON.parse(state.body);
    const agents = Array.isArray(j.agents?.team) ? j.agents.team.length : -1;
    const rest = j.engineering?.supabaseRest;
    console.log(`${stateMs <= STATE_BUDGET_MS ? '✓' : '✗'} /api/workspace/state ${stateMs}ms — agents:${agents} rest:${rest ? `${rest.ok ? 'up' : 'down'} ${rest.ms}ms` : 'n/a'}`);
    if (stateMs > STATE_BUDGET_MS || agents < 0) failures++;
  }

  // 2. agent-scoped chat — must answer from durable state within budget
  const chat = await post('/api/chat', { message: 'status?', session_id: 'smoke', user_id: 'smoke', agent: 'team-coo' }, BUDGET_MS + 2000);
  const hasDone = (chat.body ?? '').includes('[DONE]') || (chat.body ?? '').includes('"content"');
  if (!chat.ok || chat.ms > BUDGET_MS || !hasDone) {
    console.log(`✗ /api/chat?agent=team-coo → ${chat.error ?? chat.status} in ${chat.ms}ms`);
    failures++;
  } else {
    console.log(`✓ /api/chat (team-coo) ${chat.ms}ms — durable answer`);
  }

  // 3. default Heidi path — bounded (LLM inference is legitimately
  // slow on CPU; the requirement is it never hangs past the budget)
  const heidi = await post('/api/chat', { message: 'ping', session_id: 'smoke', user_id: 'smoke' }, HEIDI_BUDGET_MS + 5000);
  if (!heidi.ok || heidi.ms > HEIDI_BUDGET_MS) {
    console.log(`✗ /api/chat (heidi) → ${heidi.error ?? heidi.status} in ${heidi.ms}ms — exceeds ${HEIDI_BUDGET_MS}ms bound (REST degradation?)`);
    failures++;
  } else {
    console.log(`✓ /api/chat (heidi) ${heidi.ms}ms — within ${HEIDI_BUDGET_MS}ms bound`);
  }

  // 4. report the REST layer's own latency (informational)
  const restMs = await supabaseRestMs();
  console.log(`ℹ supabase REST /rest/v1/: ${restMs < 0 ? 'unreachable' : `${restMs}ms`}`);

  console.log(failures === 0 ? 'smoke: PASS' : `smoke: FAIL (${failures} checks)`);
  process.exit(failures === 0 ? 0 : 1);
})();
