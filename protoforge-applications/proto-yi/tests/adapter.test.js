const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { ProtoIYEngineAdapter } = require('../src/adapters/protoiy-engine');
const { EventBus, MemoryTransport } = require('../src/events/event-bus');

function createMockFlaskServer() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ursula-epm-online', apps: ['proto_iy'] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/proto_iy/project') {
        const data = body ? JSON.parse(body) : {};
        res.writeHead(201);
        res.end(JSON.stringify({ project_id: 42, status: 'created', name: data.name }));
        return;
      }
      if (req.method === 'POST' && req.url === '/proto_iy/timeline') {
        const data = body ? JSON.parse(body) : {};
        res.writeHead(201);
        res.end(JSON.stringify({ status: 'timeline_created', project_id: data.project_id }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, (err) => {
      if (err) return reject(err);
      resolve({ server, port: server.address().port });
    });
  });
}

describe('ProtoIYEngineAdapter', () => {
  let server;
  let port;
  let eventBus;
  let transport;

  before(async () => {
    const mock = await createMockFlaskServer();
    server = mock.server;
    port = mock.port;
  });

  after(() => {
    if (server) server.close();
  });

  before(() => {
    transport = new MemoryTransport();
    eventBus = new EventBus([transport]);
  });

  it('creates a project through the Flask engine and emits project.created', async () => {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({
      endpoint: `http://localhost:${port}`,
      eventBus,
      logger
    });

    const result = await adapter.createProject({
      name: 'HYDI Consolidation',
      category: 'software',
      owner_id: 101
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.project.project_id, 42);
    assert.strictEqual(result.project.name, 'HYDI Consolidation');
    assert.strictEqual(result.project.category, 'software');
    assert.strictEqual(result.project.owner_id, 101);

    const emitted = transport.ofType('project.created');
    assert.strictEqual(emitted.length, 1);
    assert.strictEqual(emitted[0].type, 'project.created');
    assert.strictEqual(emitted[0].payload.project_id, 42);
  });

  it('creates a timeline and emits milestone.created for each milestone', async () => {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({
      endpoint: `http://localhost:${port}`,
      eventBus,
      logger
    });

    transport.reset();
    const result = await adapter.createTimeline({
      project_id: '42',
      milestones: ['Design', 'Build', 'Ship'],
      start_date: '2026-08-01',
      duration_days: 30
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.milestones.length, 3);
    assert.strictEqual(result.milestones[0].milestone, 'Design');

    const emitted = transport.ofType('milestone.created');
    assert.strictEqual(emitted.length, 3);
    assert.strictEqual(emitted[0].payload.project_id, '42');
    assert.strictEqual(emitted[1].payload.milestone, 'Build');
  });

  it('checks engine health', async () => {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({
      endpoint: `http://localhost:${port}`,
      logger
    });

    const result = await adapter.health();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 'ursula-epm-online');
  });

  it('returns unreachable when the engine is down', async () => {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({
      endpoint: 'http://localhost:59999',
      logger,
      timeout: 200
    });

    const result = await adapter.health();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 'unreachable');
  });

  it('validates required project fields', async () => {
    const adapter = new ProtoIYEngineAdapter({ endpoint: `http://localhost:${port}` });
    await assert.rejects(adapter.createProject({ name: 'Only name' }), /Missing required field/);
  });

  it('validates timeline fields', async () => {
    const adapter = new ProtoIYEngineAdapter({ endpoint: `http://localhost:${port}` });
    await assert.rejects(adapter.createTimeline({ project_id: '1', milestones: [], start_date: '2026-08-01', duration_days: 10 }), /non-empty array/);
  });
});
