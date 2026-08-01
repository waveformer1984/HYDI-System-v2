const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require('../src/config');
const { Ledger } = require('../src/store');
const { createServer } = require('../src/server');

function makeServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-api-'));
  const config = loadConfig({
    HYDI_SERVICE_KEY: 'test-secret',
    PORT: '0',
    DATA_DIR: dataDir,
    LEDGER_FILE: 'events.json'
  });
  const store = new Ledger(config);
  const server = createServer(config, store);
  return new Promise((resolve, reject) => {
    server.listen(0, (err) => {
      if (err) return reject(err);
      resolve({ server, port: server.address().port, config });
    });
  });
}

async function request(port, opts, body) {
  const url = `http://localhost:${port}${opts.path}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.auth ? { 'Authorization': `Bearer test-secret` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { res, data };
}

describe('Event Gateway API', () => {
  it('health endpoint is public', async () => {
    const { server, port } = await makeServer();
    try {
      const { res, data } = await request(port, { path: '/health' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.status, 'ok');
    } finally {
      server.close();
    }
  });

  it('POST /events requires authentication', async () => {
    const { server, port } = await makeServer();
    try {
      const { res, data } = await request(port, { path: '/events', method: 'POST' }, { eventId: 'x' });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(data.ok, false);
    } finally {
      server.close();
    }
  });

  it('GET /events requires authentication', async () => {
    const { server, port } = await makeServer();
    try {
      const { res } = await request(port, { path: '/events' });
      assert.strictEqual(res.status, 401);
    } finally {
      server.close();
    }
  });

  it('rejects wrong token', async () => {
    const { server, port } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/events`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer wrong' }
      });
      assert.strictEqual(res.status, 401);
    } finally {
      server.close();
    }
  });

  it('ingests a valid event', async () => {
    const { server, port } = await makeServer();
    try {
      const body = {
        eventId: 'evt-1',
        eventType: 'audio.asset.created',
        source: 'resonate',
        version: '1',
        timestamp: '2026-08-01T00:00:00.000Z',
        payload: { assetId: 'a1', projectId: 'p1' }
      };
      const { res, data } = await request(port, { path: '/events', method: 'POST', auth: true }, body);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.event.eventId, 'evt-1');
      assert.ok(data.event.receivedAt);
    } finally {
      server.close();
    }
  });

  it('rejects invalid JSON', async () => {
    const { server, port } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/events`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer test-secret', 'Content-Type': 'application/json' },
        body: '{not json'
      });
      assert.strictEqual(res.status, 400);
    } finally {
      server.close();
    }
  });

  it('validates missing eventId', async () => {
    const { server, port } = await makeServer();
    try {
      const { res, data } = await request(port, { path: '/events', method: 'POST', auth: true }, { eventType: 'x', source: 'r', payload: {} });
      assert.strictEqual(res.status, 400);
      assert.match(data.error, /eventId/);
    } finally {
      server.close();
    }
  });

  it('validates missing payload', async () => {
    const { server, port } = await makeServer();
    try {
      const { res, data } = await request(port, { path: '/events', method: 'POST', auth: true }, { eventId: 'x', eventType: 'y', source: 'r' });
      assert.strictEqual(res.status, 400);
      assert.match(data.error, /payload/);
    } finally {
      server.close();
    }
  });

  it('retrieves a stored event by id', async () => {
    const { server, port } = await makeServer();
    try {
      const body = { eventId: 'evt-get', eventType: 'x', source: 'r', payload: {} };
      await request(port, { path: '/events', method: 'POST', auth: true }, body);
      const { res, data } = await request(port, { path: '/events/evt-get', auth: true });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.event.eventId, 'evt-get');
    } finally {
      server.close();
    }
  });

  it('returns 404 for unknown event', async () => {
    const { server, port } = await makeServer();
    try {
      const { res } = await request(port, { path: '/events/does-not-exist', auth: true });
      assert.strictEqual(res.status, 404);
    } finally {
      server.close();
    }
  });

  it('lists events', async () => {
    const { server, port } = await makeServer();
    try {
      await request(port, { path: '/events', method: 'POST', auth: true }, { eventId: 'l1', eventType: 'x', source: 'r', payload: {} });
      await request(port, { path: '/events', method: 'POST', auth: true }, { eventId: 'l2', eventType: 'x', source: 'r', payload: {} });
      const { res, data } = await request(port, { path: '/events', auth: true });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.events.length, 2);
      assert.strictEqual(data.total, 2);
    } finally {
      server.close();
    }
  });

  it('filters events by eventType', async () => {
    const { server, port } = await makeServer();
    try {
      await request(port, { path: '/events', method: 'POST', auth: true }, { eventId: 'f1', eventType: 'audio.asset.created', source: 'r', payload: {} });
      await request(port, { path: '/events', method: 'POST', auth: true }, { eventId: 'f2', eventType: 'ownership.created', source: 'r', payload: {} });
      const { res, data } = await request(port, { path: '/events?eventType=ownership.created', auth: true });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.events.length, 1);
      assert.strictEqual(data.events[0].eventId, 'f2');
    } finally {
      server.close();
    }
  });

  it('filters events by source', async () => {
    const { server, port } = await makeServer();
    try {
      await request(port, { path: '/events', method: 'POST', auth: true }, { eventId: 's1', eventType: 'x', source: 'resonate', payload: {} });
      await request(port, { path: '/events', method: 'POST', auth: true }, { eventId: 's2', eventType: 'x', source: 'proto-yi', payload: {} });
      const { res, data } = await request(port, { path: '/events?source=proto-yi', auth: true });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.events.length, 1);
      assert.strictEqual(data.events[0].eventId, 's2');
    } finally {
      server.close();
    }
  });

  it('supports replay pagination', async () => {
    const { server, port } = await makeServer();
    try {
      for (let i = 0; i < 5; i++) {
        await request(port, { path: '/events', method: 'POST', auth: true }, { eventId: `p${i}`, eventType: 'x', source: 'r', payload: {} });
      }
      const { res, data } = await request(port, { path: '/events?offset=1&limit=2', auth: true });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.events.length, 2);
      assert.strictEqual(data.events[0].eventId, 'p1');
      assert.strictEqual(data.hasMore, true);
      assert.strictEqual(data.total, 5);
    } finally {
      server.close();
    }
  });

  it('rejects unknown routes', async () => {
    const { server, port } = await makeServer();
    try {
      const { res } = await request(port, { path: '/unknown', auth: true });
      assert.strictEqual(res.status, 404);
    } finally {
      server.close();
    }
  });
});
