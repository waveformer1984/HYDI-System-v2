const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { loadConfig } = require('../src/config');
const { EventProcessor } = require('../src/processor');
const { DerivedStore, LineageGraph } = require('../src/derived-store');
const { Metrics } = require('../src/metrics');
const { ReplayEngine } = require('../src/replay');
const { createServer } = require('../src/server');
const { computeFingerprint, computeHash } = require('../src/adapters/ledger-adapter');
const { createDefaultAdapters } = require('../src/versioning/adapters');

function makeEvent(overrides = {}) {
  const payload = { ...(overrides.payload || {}) };
  const eventId = overrides.eventId || `evt-${Math.random().toString(36).slice(2)}`;
  const eventType = overrides.eventType || 'audio.asset.created';
  const source = overrides.source || 'resonate';
  const version = overrides.version || '1';
  const timestamp = overrides.timestamp || new Date().toISOString();
  const created_at = timestamp;
  const fingerprint = computeFingerprint(source, eventId, eventType);
  const hash = computeHash(fingerprint, eventType, payload);
  return {
    id: `raw-${fingerprint.slice(0, 8)}`,
    fingerprint,
    eventId,
    eventType,
    source,
    version,
    timestamp,
    payload,
    hash,
    created_at
  };
}

class FakeLedger {
  constructor(events = []) {
    this.events = events;
  }
  async get(fingerprint) {
    const e = this.events.find(x => x.fingerprint === fingerprint);
    return e ? { ok: true, event: e } : { ok: false, error: 'Not found' };
  }
  async list(options = {}) {
    let events = this.events;
    if (options.since) {
      events = events.filter(e => e.created_at >= options.since);
    }
    if (options.eventType) {
      events = events.filter(e => e.eventType === options.eventType);
    }
    const offset = parseInt(options.offset, 10) || 0;
    const limit = parseInt(options.limit, 10) || 100;
    return { ok: true, events: events.slice(offset, offset + limit), total: events.length };
  }
}

async function makeApp(events = []) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-'));
  const config = loadConfig({ DATA_DIR: dataDir });
  const ledger = new FakeLedger(events);
  const processor = new EventProcessor({
    versionAdapters: createDefaultAdapters(),
    processorVersion: config.processorVersion
  });
  const store = new DerivedStore({ dataDir });
  const lineage = new LineageGraph(store);
  const metrics = new Metrics();
  const replay = new ReplayEngine({ ledger, processor, store, metrics });
  const server = createServer(config, { store, lineage, metrics, replay });
  return new Promise((resolve, reject) => {
    server.listen(0, (err) => {
      if (err) return reject(err);
      resolve({
        server,
        port: server.address().port,
        config,
        store,
        lineage,
        metrics
      });
    });
  });
}

async function request(port, opts, body) {
  const url = `http://localhost:${port}${opts.path}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { res, data };
}

async function withApp(events, fn) {
  const app = await makeApp(events);
  try {
    return await fn(app);
  } finally {
    app.server.close();
  }
}

describe('CASCADE v1', () => {
  it('GET /health returns status', async () => {
    await withApp([], async (app) => {
      const { res, data } = await request(app.port, { path: '/health' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.status, 'ok');
    });
  });

  it('POST /replay processes all events from beginning', async () => {
    const parent = makeEvent({ eventId: 'parent', payload: {} });
    const child = makeEvent({ eventId: 'child', payload: { parentFingerprint: parent.fingerprint } });
    await withApp([parent, child], async (app) => {
      const { res, data } = await request(app.port, { path: '/replay', method: 'POST' }, { from: 'beginning' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.processed, 2);
      assert.strictEqual(data.total, 2);
    });
  });

  it('POST /replay from fingerprint excludes earlier events', async () => {
    const parent = makeEvent({ eventId: 'parent2', payload: {}, timestamp: '2026-08-01T00:00:00.000Z' });
    const child = makeEvent({ eventId: 'child2', payload: {}, timestamp: '2026-08-01T00:00:01.000Z' });
    await withApp([parent, child], async (app) => {
      const { res, data } = await request(app.port, { path: '/replay', method: 'POST' }, { from: child.fingerprint });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.processed, 1);
      assert.strictEqual(data.total, 1);
    });
  });

  it('POST /replay by event type', async () => {
    const e = makeEvent({ eventId: 'filter', eventType: 'payment.completed' });
    const other = makeEvent({ eventId: 'other', eventType: 'audio.asset.created' });
    await withApp([e, other], async (app) => {
      const { res, data } = await request(app.port, { path: '/replay', method: 'POST' }, { from: 'beginning', eventType: 'payment.completed' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.processed, 1);
      assert.strictEqual(data.total, 1);
    });
  });

  it('GET /events lists derived events', async () => {
    const e = makeEvent({});
    await withApp([e], async (app) => {
      await request(app.port, { path: '/replay', method: 'POST' }, { from: 'beginning' });
      const { res, data } = await request(app.port, { path: '/events' });
      assert.strictEqual(res.status, 200);
      assert.ok(data.events);
      assert.strictEqual(data.events.length, 1);
    });
  });

  it('GET /events/:id returns a derived event', async () => {
    const e = makeEvent({});
    await withApp([e], async (app) => {
      await request(app.port, { path: '/replay', method: 'POST' }, { from: 'beginning' });
      const list = await request(app.port, { path: '/events' });
      const id = list.data.events[0].id;
      const { res, data } = await request(app.port, { path: `/events/${id}` });
      assert.strictEqual(res.status, 200);
      assert.ok(data.event);
    });
  });

  it('GET /lineage/:fingerprint returns lineage', async () => {
    const parent = makeEvent({ eventId: 'p', payload: {} });
    const child = makeEvent({ eventId: 'c', payload: { parentFingerprint: parent.fingerprint } });
    await withApp([parent, child], async (app) => {
      await request(app.port, { path: '/replay', method: 'POST' }, { from: 'beginning' });
      const list = await request(app.port, { path: '/events' });
      const parentFp = list.data.events[0].fingerprint;
      const { res, data } = await request(app.port, { path: `/lineage/${parentFp}` });
      assert.strictEqual(res.status, 200);
      assert.ok(data.event);
      assert.ok(data.children);
      assert.ok(data.ancestors);
      assert.ok(data.descendants);
    });
  });

  it('GET /metrics returns metrics snapshot', async () => {
    const e = makeEvent({});
    await withApp([e], async (app) => {
      await request(app.port, { path: '/replay', method: 'POST' }, { from: 'beginning' });
      const { res, data } = await request(app.port, { path: '/metrics' });
      assert.strictEqual(res.status, 200);
      assert.ok(data.metrics);
      assert.strictEqual(typeof data.metrics.eventsProcessed, 'number');
    });
  });
});
