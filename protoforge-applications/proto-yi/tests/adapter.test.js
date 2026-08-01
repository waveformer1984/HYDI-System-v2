const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ProtoIYEngineAdapter } = require('../src/adapters/protoiy-engine');
const { EventBus, MemoryTransport } = require('../src/events/event-bus');

function createFakeClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    endpoint: 'http://test-engine',
    async post(path, body) {
      calls.push({ method: 'post', path, body });
      if (overrides.post) return overrides.post(path, body);
      return { project_id: 42, status: 'created' };
    },
    async get(path) {
      calls.push({ method: 'get', path });
      if (overrides.get) return overrides.get(path);
      return { status: 'test' };
    }
  };
}

describe('ProtoIYEngineAdapter', () => {
  it('creates a project through the injected client and emits project.created', async () => {
    const transport = new MemoryTransport();
    const eventBus = new EventBus([transport]);
    const client = createFakeClient();
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({ client, eventBus, logger });

    const result = await adapter.createProject({
      name: 'HYDI Consolidation',
      category: 'software',
      owner_id: 101
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.project.project_id, 42);
    assert.strictEqual(client.calls.length, 1);
    assert.strictEqual(client.calls[0].method, 'post');
    assert.strictEqual(client.calls[0].path, '/proto_iy/project');
    assert.strictEqual(client.calls[0].body.name, 'HYDI Consolidation');

    const emitted = transport.ofType('project.created');
    assert.strictEqual(emitted.length, 1);
    assert.strictEqual(emitted[0].payload.project_id, 42);
    assert.strictEqual(emitted[0].payload.name, 'HYDI Consolidation');
  });

  it('fails when the engine returns a non-OK response', async () => {
    const client = createFakeClient({
      post: () => { const err = new Error('bad request'); err.status = 400; throw err; }
    });
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({ client, logger });

    await assert.rejects(
      adapter.createProject({ name: 'Bad', category: 'test', owner_id: 1 }),
      /bad request/
    );
  });

  it('translates project GET response', async () => {
    const client = createFakeClient({
      get: (path) => {
        if (path === '/proto_iy/project/7') return { project_id: 7, name: 'Fetched', category: 'test' };
        return {};
      }
    });
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({ client, logger });

    const result = await adapter.getProject(7);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.project.project_id, 7);
    assert.strictEqual(client.calls[0].path, '/proto_iy/project/7');
  });

  it('creates a timeline and emits timeline.created and milestone.reached', async () => {
    const transport = new MemoryTransport();
    const eventBus = new EventBus([transport]);
    const client = createFakeClient();
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({ client, eventBus, logger });

    const result = await adapter.createTimeline({
      project_id: 42,
      milestones: ['Design', 'Build', 'Ship'],
      start_date: '2026-08-01',
      duration_days: 30
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.milestones.length, 3);
    assert.strictEqual(client.calls[0].path, '/proto_iy/timeline');

    const timelineEvents = transport.ofType('timeline.created');
    assert.strictEqual(timelineEvents.length, 1);
    assert.strictEqual(timelineEvents[0].payload.project_id, 42);

    const milestoneEvents = transport.ofType('milestone.reached');
    assert.strictEqual(milestoneEvents.length, 3);
    assert.strictEqual(milestoneEvents[0].payload.milestone, 'Design');
    assert.strictEqual(milestoneEvents[2].payload.milestone, 'Ship');
  });

  it('translates timeline GET response', async () => {
    const client = createFakeClient({
      get: (path) => {
        if (path === '/proto_iy/timeline/42') return [{ milestone: 'M1' }];
        return [];
      }
    });
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({ client, logger });

    const result = await adapter.getTimeline(42);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.timeline, [{ milestone: 'M1' }]);
  });

  it('reports engine health through the injected client', async () => {
    const client = createFakeClient({
      get: (path) => {
        if (path === '/health') return { status: 'ursula-epm-online' };
        return {};
      }
    });
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({ client, logger });

    const result = await adapter.health();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 'ursula-epm-online');
    assert.strictEqual(client.calls[0].path, '/health');
  });

  it('reports unreachable when the client throws', async () => {
    const client = createFakeClient({
      get: () => { throw new Error('connection refused'); }
    });
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({ client, logger });

    const result = await adapter.health();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 'unreachable');
    assert.strictEqual(result.error, 'connection refused');
  });

  it('validates required project fields', async () => {
    const client = createFakeClient();
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({ client, logger });
    await assert.rejects(adapter.createProject({ name: 'Only name' }), /Missing required field/);
  });

  it('validates timeline fields', async () => {
    const client = createFakeClient();
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({ client, logger });
    await assert.rejects(
      adapter.createTimeline({ project_id: '1', milestones: [], start_date: '2026-08-01', duration_days: 10 }),
      /non-empty array/
    );
  });

  it('throws on missing required timeline fields', async () => {
    const client = createFakeClient();
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const adapter = new ProtoIYEngineAdapter({ client, logger });
    await assert.rejects(
      adapter.createTimeline({ project_id: '1', start_date: '2026-08-01', duration_days: 10 }),
      /Missing required field: milestones/
    );
  });
});
