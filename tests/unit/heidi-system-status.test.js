'use strict';

/**
 * Unified HYDI system status (heidi-core/status/system-status.js): every
 * component is HEALTHY / DEGRADED / UNAVAILABLE / UNKNOWN from real
 * evidence, and "the port answered" is never reported as healthy by itself.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { checkSystem, formatSystemStatus, isSystemReportQuery } = require('../../heidi-core/status/system-status');
const { MemoryRuntime } = require('../../heidi-core/memory/memory-runtime');

const NOW = Date.parse('2026-10-29T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function makeRoot({ daemon, frank } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-status-'));
  if (daemon) fs.writeFileSync(path.join(root, '.heidi-daemon-status.json'), JSON.stringify(daemon));
  if (frank) {
    fs.mkdirSync(path.join(root, '.runtime', 'observation'), { recursive: true });
    fs.writeFileSync(path.join(root, '.runtime', 'observation', 'frank.json'), JSON.stringify(frank));
  }
  return root;
}

/** fetch stub: url -> { status, body } | 'refused' | 'hang' */
function fakeFetch(routes) {
  return async (url, opts = {}) => {
    const r = routes[url];
    if (!r || r === 'refused') throw new TypeError('fetch failed');
    if (r === 'hang') {
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'TimeoutError';
          reject(e);
        });
      });
    }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
}

const URLS = { ollama: 'http://o', web: 'http://w', mobile: 'http://m', protoforge: 'http://p' };
const allGood = {
  'http://o/api/tags': { status: 200, body: { models: [{ name: 'qwen2.5:3b' }, { name: 'llama3.2:3b' }] } },
  'http://w/api/ping': { status: 200, body: { status: 'alive' } },
  'http://w/api/health': { status: 200, body: { status: 'healthy' } },
  'http://m/api/health': { status: 200, body: { status: 'ok' } },
  'http://p/health': { status: 200, body: { status: 'ok' } },
};
const goodDaemon = { state: 'running', lastCycleOutcome: 'SUCCESS', consecutiveFailures: 0, persistence: { pg: 'ok', rest: 'ok', checkedAt: iso(20000) }, updatedAt: iso(20000) };
const goodFrank = { at: iso(30000), level: 'OK', issues: [] };
const legacy = (failed = [], { counts = { queued: 2, awaiting_approval: 1, completed: 5 }, inFlight = [] } = {}) => ({
  db: {},
  getMissions: async (status) => (status === 'failed' ? failed : Array.isArray(status) ? inFlight : []),
  countMissionsByStatus: async () => counts,
});

function memoryRuntime() {
  return new MemoryRuntime({ dbPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-status-mem-')), 'm.db') });
}

async function run(overrides = {}) {
  return checkSystem({
    now: NOW,
    urls: URLS,
    timeoutMs: 50,
    env: { HEIDI_MOBILE_TOKEN: 'set', HEIDI_SECRET: 'set' },
    fetchImpl: fakeFetch(allGood),
    root: makeRoot({ daemon: goodDaemon, frank: goodFrank }),
    memoryRuntime: memoryRuntime(),
    legacyMemory: legacy(),
    ...overrides,
  });
}

const byName = (report) => Object.fromEntries(report.components.map((c) => [c.name, c]));

describe('system status', () => {
  it('reports HEALTHY only when every component proves it', async () => {
    const r = await run();
    expect(r.overall).toBe('HEALTHY');
    expect(Object.values(byName(r)).map((c) => c.state)).toEqual(Array(r.components.length).fill('HEALTHY'));
    expect(byName(r)['local-model'].detail).toBe('2 model(s): qwen2.5:3b, llama3.2:3b');
    expect(formatSystemStatus(r)).toMatch(/^✅ HYDI system: HEALTHY/);
  });

  it('an HTTP answer without real health is DEGRADED, not healthy', async () => {
    const r = await run({
      fetchImpl: fakeFetch({
        ...allGood,
        'http://o/api/tags': { status: 200, body: { models: [] } },
        'http://w/api/health': { status: 503, body: { status: 'degraded' } },
        'http://p/health': { status: 500, body: { status: 'error' } },
      }),
    });
    const c = byName(r);
    expect(c['local-model']).toMatchObject({ state: 'DEGRADED', detail: 'Ollama is up but has no models installed' });
    expect(c['heidi-web']).toMatchObject({ state: 'DEGRADED', detail: 'alive, but its health check says degraded' });
    expect(c['protoforge-core'].state).toBe('DEGRADED');
    expect(r.overall).toBe('DEGRADED');
  });

  it('unreachable and timed-out services are UNAVAILABLE; no model or memory makes the system UNAVAILABLE', async () => {
    const r = await run({ fetchImpl: fakeFetch({ ...allGood, 'http://o/api/tags': 'hang', 'http://m/api/health': 'refused', 'http://w/api/ping': 'refused' }) });
    const c = byName(r);
    expect(c['local-model']).toMatchObject({ state: 'UNAVAILABLE', detail: 'Ollama no answer in 50ms' });
    expect(c['mobile-chat'].state).toBe('UNAVAILABLE');
    expect(c['heidi-web'].state).toBe('UNAVAILABLE');
    expect(r.overall).toBe('UNAVAILABLE');

    const noMemory = await run({ memoryRuntime: { store: null, storeError: 'disk I/O error' } });
    expect(byName(noMemory).memory).toMatchObject({ state: 'UNAVAILABLE', detail: 'persistent memory is off: disk I/O error' });
    expect(noMemory.overall).toBe('UNAVAILABLE');
  });

  it('missing or stale status files are UNKNOWN, never assumed healthy', async () => {
    const missing = byName(await run({ root: makeRoot() }));
    expect(missing.database.state).toBe('UNKNOWN');
    expect(missing['execution-daemon'].state).toBe('UNKNOWN');
    expect(missing['frank-host'].state).toBe('UNKNOWN');

    const stale = byName(await run({ root: makeRoot({ daemon: { ...goodDaemon, updatedAt: iso(10 * 60000) }, frank: { ...goodFrank, at: iso(20 * 60000) } }) }));
    expect(stale.database).toMatchObject({ state: 'UNKNOWN', detail: 'last probe 10 min ago (stale)' });
    expect(stale['frank-host']).toMatchObject({ state: 'UNKNOWN', detail: 'snapshot 20 min old (stale)' });
  });

  it('reads the database verdict and worker failures from the daemon\'s own probe', async () => {
    const half = byName(await run({ root: makeRoot({ daemon: { ...goodDaemon, persistence: { pg: 'ok', rest: 'down' } }, frank: goodFrank }) }));
    expect(half.database).toMatchObject({ state: 'DEGRADED', detail: 'Postgres ok, Supabase REST down' });
    const down = byName(await run({ root: makeRoot({ daemon: { ...goodDaemon, persistence: { pg: 'down', rest: 'down' }, consecutiveFailures: 4, lastError: 'ECONNREFUSED 127.0.0.1:54322' }, frank: goodFrank }) }));
    expect(down.database.state).toBe('UNAVAILABLE');
    expect(down['execution-daemon']).toMatchObject({ state: 'DEGRADED' });
    expect(down['execution-daemon'].detail).toMatch(/4 failed cycles in a row; last error: ECONNREFUSED/);
  });

  it('surfaces Frank issues, auth gaps, legacy RAM mode and recent failures', async () => {
    const r = byName(await run({
      env: {},
      root: makeRoot({ daemon: goodDaemon, frank: { at: iso(30000), level: 'CRIT', issues: [{ text: 'C: 1.2 GB free' }] } }),
      legacyMemory: { db: null, inMemoryData: {}, getMissions: async () => [{ goal: 'restart rezonate', status: 'failed', updated_at: '2026-10-29 10:00:00' }], countMissionsByStatus: async () => ({}) },
    }));
    expect(r['frank-host']).toMatchObject({ state: 'DEGRADED', detail: 'CRIT: 1 issue(s) — C: 1.2 GB free' });
    expect(r.auth.state).toBe('DEGRADED');
    expect(r.auth.detail).toMatch(/NO login/);
    expect(r.memory.state).toBe('DEGRADED');
    expect(r.memory.detail).toMatch(/legacy store .* RAM only/);
    expect(r['recent-failures']).toMatchObject({ state: 'DEGRADED', detail: '1 failed mission(s) in 24h, latest: restart rezonate' });
  });

  it('summarises the task queue and flags a task stuck mid-run', async () => {
    expect(byName(await run())['task-queue']).toMatchObject({ state: 'HEALTHY', detail: '1 awaiting approval, 2 queued, 0 in progress, 0 blocked' });
    const stuck = byName(await run({ legacyMemory: legacy([], { counts: { running: 1 }, inFlight: [{ id: 7, status: 'running', updated_at: iso(15 * 60000) }] }) }));
    expect(stuck['task-queue']).toMatchObject({ state: 'DEGRADED', detail: '0 awaiting approval, 0 queued, 1 in progress, 0 blocked; task #7 has been running for over 10 min' });
    expect(byName(await run({ legacyMemory: { getMissions: async () => [] } }))['task-queue'].state).toBe('UNKNOWN');
  });

  it('recognizes the report phrases only', () => {
    for (const q of ['system report', 'Status Report', ' health report ', '/status', 'full status']) expect(isSystemReportQuery(q)).toBe(true);
    for (const q of ['status', 'what is the status of the deploy?', 'report']) expect(isSystemReportQuery(q)).toBe(false);
  });
});

describe('heidi-core /system/status and chat report', () => {
  const HeidiCore = require('../../heidi-core/server');

  it('serves the report and answers "system report" without calling the model', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-status-core-'));
    const core = new HeidiCore({ memory: { dbPath: path.join(dir, 'legacy.db') }, conversationDbPath: path.join(dir, 'heidi_memory.db') });
    let modelCalls = 0;
    core.brain = { chatWithTools: async () => { modelCalls += 1; return { text: 'x', tool_calls: [] }; } };
    // Point every probe at a closed port so the test never depends on what runs on this machine.
    const closed = 'http://127.0.0.1:9';
    core.getSystemStatus = () => checkSystem({ urls: { ollama: closed, web: closed, mobile: closed, protoforge: closed }, timeoutMs: 500, env: {}, root: dir, memoryRuntime: core.memoryRuntime, legacyMemory: core.memory });
    const server = core.app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/system/status`);
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(body.overall).toBe('UNAVAILABLE');
      expect(body.components.find((c) => c.name === 'local-model').state).toBe('UNAVAILABLE');
      expect(body.text).toMatch(/^❌ HYDI system: UNAVAILABLE/);

      const sse = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: '/chat-tools', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
          let buf = '';
          r.on('data', (c) => { buf += c; });
          r.on('end', () => resolve(buf.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)))));
        });
        req.on('error', reject);
        req.end(JSON.stringify({ input: 'system report' }));
      });
      expect(sse[0].t).toMatch(/HYDI system: UNAVAILABLE/);
      expect(sse[1]).toMatchObject({ done: true, model: 'system-status', overall: 'UNAVAILABLE' });
      expect(modelCalls).toBe(0);
    } finally {
      server.close();
      core.memoryRuntime.store.close();
    }
  });
});
