'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildFrankSnapshot, formatFrankSnapshot } = require('../../lib/observation/frank-snapshot');
const observer = require('../../scripts/frank-observer');
const { createPhoneObserveHandler, resetRateLimit } = require('../../lib/observation/phone-observe-route');

const NOW = Date.parse('2026-10-25T03:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function repo(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-obs-'));
  for (const [rel, value] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return root;
}

function sample(overrides = {}) {
  return {
    schema: 'observatory-sample/1',
    ts: iso(30 * 1000),
    host: {
      cpu_pct: 12, mem_total_mb: 16384, mem_avail_mb: 6144, commit_pct: 61, uptime_hours: 40.2,
      disks: [{ drive: 'C', total_gb: 476.3, free_gb: 31.5, health: 'Healthy' }],
      top_procs: [{ name: 'vmmem', pid: 1, ws_mb: 5000 }],
    },
    gpu: { available: true, name: 'GPU' },
    docker: { available: true, containers: [
      { name: 'supabase_db', state: 'running', health: 'healthy', restarts: 0 },
      { name: 'supabase_rest', state: 'running', health: 'none', restarts: 0 },
    ] },
    pm2: { available: true, processes: [
      { name: 'heidi-web-standalone', status: 'online', restarts: 2 },
      { name: 'hydi-daemon', status: 'online', restarts: 0 },
      { name: 'heidi-assessment-crew', status: 'stopped', restarts: 0 },
    ] },
    ollama: { reachable: true, models_loaded: [{ name: 'qwen2.5:3b' }] },
    probes: { web_3000: true },
    findings_active: [],
    ...overrides,
  };
}

describe('Frank snapshot', () => {
  it('reports OK with vitals when every source is fresh and clean', () => {
    const root = repo({
      '.observatory/current.json': sample(),
      '.runtime/storage/status.json': { at: iso(60 * 1000), level: 'OK', freeGb: 31.5, trendGbPerDay: -0.4 },
      '.heidi-daemon-status.json': { updatedAt: iso(20 * 1000), state: 'running', lastCycleOutcome: 'SUCCESS', consecutiveFailures: 0 },
    });
    const s = buildFrankSnapshot({ root, now: NOW });
    expect(s.level).toBe('OK');
    expect(s.issues).toEqual([]);
    expect(s.host).toMatchObject({ cpuPct: 12, memFreeGb: 6, memTotalGb: 16, diskC: { freeGb: 31.5 } });
    expect(s.pm2).toMatchObject({ online: 2, total: 3, errored: [] });
    expect(s.docker).toMatchObject({ running: 2, total: 2, unhealthy: [] });
    expect(s.sources.observatory).toMatchObject({ present: true, stale: false, ageSec: 30 });
    const text = formatFrankSnapshot(s);
    expect(text).toContain('Frank: OK');
    expect(text).toContain('C: 31.5/476.3 GB free');
    expect(text).toContain('PM2: 2/3 online');
  });

  it('never reads a missing or stale monitor as healthy', () => {
    expect(buildFrankSnapshot({ root: repo(), now: NOW })).toMatchObject({
      level: 'CRIT',
      issues: [expect.objectContaining({ id: 'observatory-missing', severity: 'crit' })],
    });
    const stale = buildFrankSnapshot({ root: repo({ '.observatory/current.json': sample({ ts: iso(10 * 60 * 1000) }) }), now: NOW });
    expect(stale.level).toBe('CRIT');
    expect(stale.issues[0]).toMatchObject({ id: 'observatory-stale' });
    expect(stale.issues[0].text).toContain('10 min old');
  });

  it('surfaces monitor findings, errored PM2 apps, unhealthy containers, storage and daemon trouble', () => {
    const root = repo({
      '.observatory/current.json': sample({
        findings_active: [
          { id: 'host-mem-crit', severity: 'crit', summary: 'only 0.6 GB physical RAM free' },
          { id: 'telemetry-gap', severity: 'info', summary: 'gap' },
        ],
        pm2: { available: true, processes: [{ name: 'heidi-core', status: 'errored', restarts: 15 }] },
        docker: { available: true, containers: [{ name: 'supabase_db', state: 'running', health: 'unhealthy' }] },
      }),
      '.runtime/storage/status.json': { at: iso(60 * 1000), level: 'CRITICAL', freeGb: 2.1 },
      '.heidi-daemon-status.json': { updatedAt: iso(10 * 1000), lastCycleOutcome: 'HARD_FAILURE', consecutiveFailures: 1 },
    });
    const s = buildFrankSnapshot({ root, now: NOW });
    const ids = s.issues.map((i) => i.id);
    expect(s.level).toBe('CRIT');
    expect(ids).toEqual(expect.arrayContaining([
      'host-mem-crit', 'pm2-errored-heidi-core', 'docker-unhealthy-supabase_db', 'storage-CRITICAL', 'daemon-failing',
    ]));
    expect(ids).not.toContain('telemetry-gap');
    // crit before warn
    expect(s.issues.findIndex((i) => i.severity === 'warn')).toBeGreaterThan(s.issues.filter((i) => i.severity === 'crit').length - 1);
  });

  it('reads the BOM PowerShell 5.1 can write', () => {
    const root = repo({ '.observatory/current.json': `﻿${JSON.stringify(sample())}` });
    expect(buildFrankSnapshot({ root, now: NOW }).sources.observatory.present).toBe(true);
  });
});

describe('frank-observer loop', () => {
  function harness(files) {
    const root = repo(files);
    const posts = [];
    const collect = jest.fn(async () => ({ ok: true }));
    const opts = {
      root,
      platform: 'win32',
      collect,
      // The real collectStrays spawns powershell + `pm2 jlist` (20s each).
      // These tests exercise the pass logic, not process enumeration.
      collectStrays: async () => [],
      // The real read spawns `pm2 jlist`; the pass logic is what's tested.
      readPm2List: async () => ({ list: [], ageMs: 0 }),
      post: async (channel, body) => { posts.push({ channel, body }); return { ok: true }; },
    };
    return { root, posts, collect, opts };
  }

  it('reads PM2 once per pass and shares it: sanitized file for the collector, the list for strays', async () => {
    const h = harness({ '.observatory/current.json': sample({ ts: iso(2 * 60 * 1000) }) });
    const list = [{ name: 'heidi-core', pid: 42, pm2_env: { status: 'online', restart_time: 1, SECRET_TOKEN: 'do-not-write' }, monit: { memory: 1, cpu: 0 } }];
    const readPm2List = jest.fn(async () => ({ list, ageMs: 1234 }));
    const collectStrays = jest.fn(async () => []);
    await observer.runObservationPass({ ...h.opts, readPm2List, collectStrays, now: () => NOW });
    expect(readPm2List).toHaveBeenCalledTimes(1);
    expect(collectStrays).toHaveBeenCalledWith(h.root, expect.objectContaining({ pm2List: list }));
    const snapPath = path.join(h.root, '.runtime', 'observation', 'pm2-sanitized.json');
    expect(h.collect).toHaveBeenCalledWith(h.root, { pm2SnapshotPath: snapPath });
    const raw = fs.readFileSync(snapPath, 'utf8');
    expect(raw).not.toContain('do-not-write');
    expect(raw).not.toContain('SECRET_TOKEN');
    expect(JSON.parse(raw)).toMatchObject({ available: true, ageMs: 1234, processes: [{ name: 'heidi-core', pid: 42, status: 'online', restarts: 1 }] });
  });

  it('an unreadable PM2 is written as unavailable with the reason, and strays gets null (no second jlist)', async () => {
    const h = harness({ '.observatory/current.json': sample({ ts: iso(2 * 60 * 1000) }) });
    const collectStrays = jest.fn(async () => null);
    await observer.runObservationPass({ ...h.opts, readPm2List: async () => ({ list: null, why: 'pm2 jlist still answering after 20s' }), collectStrays, now: () => NOW, log: () => {} });
    expect(collectStrays).toHaveBeenCalledWith(h.root, expect.objectContaining({ pm2List: null }));
    const snap = JSON.parse(fs.readFileSync(path.join(h.root, '.runtime', 'observation', 'pm2-sanitized.json'), 'utf8'));
    expect(snap).toMatchObject({ available: false, reason: 'pm2 jlist still answering after 20s', processes: [] });
  });

  it('a fix-list collector that never resolves still lets alerts evaluate and writes a timeout item', async () => {
    const h = harness({ '.observatory/current.json': sample({ pm2: { available: true, processes: [{ name: 'x', status: 'errored' }] } }) });
    const never = () => new Promise(() => {});
    const passOpts = { ...h.opts, now: () => NOW, fixList: true, fixListInputs: never, fixListTimeoutMs: 50 };
    await observer.runObservationPass(passOpts); // pass 1 — records the crit, raises nothing yet
    await observer.runObservationPass(passOpts); // pass 2 — confirms and alerts
    expect(h.posts.some((p) => p.channel === 'alerts')).toBe(true); // alerting did not wait on the collector
    const list = JSON.parse(fs.readFileSync(path.join(h.root, '.runtime', 'fixlist', 'current.json'), 'utf8'));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'fixlist_timeout', level: 'UNKNOWN' });
  });

  it('runs the collector only when the sample is older than 75s, and only on Windows', async () => {
    const fresh = harness({ '.observatory/current.json': sample() });
    await observer.runObservationPass({ ...fresh.opts, now: () => NOW });
    expect(fresh.collect).not.toHaveBeenCalled();

    const old = harness({ '.observatory/current.json': sample({ ts: iso(2 * 60 * 1000) }) });
    await observer.runObservationPass({ ...old.opts, now: () => NOW });
    expect(old.collect).toHaveBeenCalledWith(old.root, expect.objectContaining({ pm2SnapshotPath: expect.any(String) }));

    const linux = harness({});
    const { snapshot } = await observer.runObservationPass({ ...linux.opts, platform: 'linux', now: () => NOW });
    expect(linux.collect).not.toHaveBeenCalled();
    expect(snapshot.collector).toMatchObject({ ok: false, skipped: 'collector is Windows-only' });
    const written = JSON.parse(fs.readFileSync(path.join(linux.root, '.runtime', 'observation', 'frank.json'), 'utf8'));
    expect(written.device).toBe('frank');
  });

  it('alerts a critical issue only after two passes, once, then posts the recovery once', async () => {
    const files = {
      '.observatory/current.json': sample({ pm2: { available: true, processes: [{ name: 'heidi-core', status: 'errored', restarts: 9 }] } }),
    };
    const h = harness(files);
    let t = NOW;
    const pass = () => observer.runObservationPass({ ...h.opts, now: () => t });

    await pass();
    expect(h.posts).toHaveLength(0); // one sample is not enough
    t += 60 * 1000;
    await pass();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].channel).toBe('alerts');
    expect(h.posts[0].body).toContain('heidi-core is errored in PM2');
    t += 60 * 1000;
    await pass();
    expect(h.posts).toHaveLength(1);

    fs.writeFileSync(path.join(h.root, '.observatory', 'current.json'), JSON.stringify(sample({ ts: new Date(t + 60 * 1000 - 10 * 1000).toISOString() })));
    t += 60 * 1000;
    await pass();
    expect(h.posts).toHaveLength(2);
    expect(h.posts[1].body).toContain('recovered');
    t += 60 * 1000;
    fs.writeFileSync(path.join(h.root, '.observatory', 'current.json'), JSON.stringify(sample({ ts: new Date(t - 10 * 1000).toISOString() })));
    await pass();
    expect(h.posts).toHaveLength(2);
  });

  it('leaves disk alerts to the storage guard', async () => {
    const h = harness({
      '.observatory/current.json': sample({ findings_active: [{ id: 'disk-c-crit', severity: 'crit', summary: 'C: 2 GB free' }] }),
      '.runtime/storage/status.json': { at: iso(60 * 1000), level: 'CRITICAL', freeGb: 2 },
    });
    await observer.runObservationPass({ ...h.opts, now: () => NOW });
    const { snapshot } = await observer.runObservationPass({ ...h.opts, now: () => NOW + 60 * 1000 });
    expect(snapshot.level).toBe('CRIT');
    expect(h.posts).toHaveLength(0);
  });

  it('retries an alert the board did not accept', async () => {
    const h = harness({ '.observatory/current.json': sample({ pm2: { available: true, processes: [{ name: 'x', status: 'errored' }] } }) });
    let accept = false;
    const post = async (channel, body) => { h.posts.push({ channel, body }); return accept ? { ok: true } : { ok: false, skipped: true }; };
    await observer.runObservationPass({ ...h.opts, post, now: () => NOW });
    await observer.runObservationPass({ ...h.opts, post, now: () => NOW + 60 * 1000 });
    accept = true;
    await observer.runObservationPass({ ...h.opts, post, now: () => NOW + 120 * 1000 });
    await observer.runObservationPass({ ...h.opts, post, now: () => NOW + 180 * 1000 });
    expect(h.posts).toHaveLength(2);
  });

  it('reports a failed board post to stderr instead of failing silently', async () => {
    // Without a board token every post is skipped; the err log is the only
    // place that can explain why #alerts stayed quiet.
    const h = harness({ '.observatory/current.json': sample({ pm2: { available: true, processes: [{ name: 'x', status: 'errored' }] } }) });
    const log = jest.fn();
    const post = jest.fn(async () => ({ ok: false, skipped: true, error: 'board auth not configured' }));
    await observer.runObservationPass({ ...h.opts, post, log, now: () => NOW });
    await observer.runObservationPass({ ...h.opts, post, log, now: () => NOW + 60 * 1000 });
    expect(post).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      '[frank-observer] board post to #alerts failed: board auth not configured',
    );
  });

  it('is declared in ecosystem.config.js as a long-lived loop', () => {
    const entry = require('../../ecosystem.config.js').apps.find((a) => a.name === observer.APP_NAME);
    expect(entry).toMatchObject({ script: 'scripts/frank-observer.js', autorestart: true });
    expect(entry.cron_restart).toBeUndefined();
  });
});

describe('GET /api/phone/observe', () => {
  function call(handler, { method = 'GET', auth } = {}) {
    const res = {
      code: null, body: null, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; return this; },
    };
    return Promise.resolve(handler({ method, headers: auth ? { authorization: auth } : {} }, res)).then(() => res);
  }
  const env = { HYDI_PHONE_READ_TOKEN: 'read-test' };
  beforeEach(() => resetRateLimit());

  it('serves the snapshot to the read token only', async () => {
    const handler = createPhoneObserveHandler({ env, build: () => ({ device: 'frank', level: 'OK' }) });
    expect((await call(handler)).code).toBe(401);
    expect((await call(handler, { auth: 'Bearer wrong' })).code).toBe(401);
    expect((await call(handler, { method: 'POST', auth: 'Bearer read-test' })).code).toBe(405);
    const ok = await call(handler, { auth: 'Bearer read-test' });
    expect(ok.code).toBe(200);
    expect(ok.body).toEqual({ ok: true, snapshot: { device: 'frank', level: 'OK' }, fixList: null });
    expect(ok.headers['Cache-Control']).toBe('no-store');
    expect(JSON.stringify(ok.body)).not.toContain('read-test');
  });

  it('refuses when no token is configured and rate-limits', async () => {
    expect((await call(createPhoneObserveHandler({ env: {} }), { auth: 'Bearer x' })).code).toBe(503);
    const handler = createPhoneObserveHandler({ env, build: () => ({}), now: () => NOW });
    for (let i = 0; i < 30; i += 1) await call(handler, { auth: 'Bearer read-test' });
    expect((await call(handler, { auth: 'Bearer read-test' })).code).toBe(429);
  });

  it('is not reachable from the public internet', () => {
    const { isPublicPath } = require('../../lib/security/ingressGate');
    expect(isPublicPath('/api/phone/observe', {})).toBe(false);
  });
});

describe('GET /api/phone/observe evidence location', () => {
  it('reads the evidence files under the server working directory', async () => {
    const root = repo({ '.observatory/current.json': sample() });
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    resetRateLimit();
    const handler = createPhoneObserveHandler({ env: { HYDI_PHONE_READ_TOKEN: 't' }, now: () => NOW });
    cwd.mockRestore();
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ method: 'GET', headers: { authorization: 'Bearer t' } }, res);
    expect(res.code).toBe(200);
    expect(res.body.snapshot.sources.observatory.present).toBe(true);
    expect(res.body.snapshot.level).toBe('OK');
  });
});
