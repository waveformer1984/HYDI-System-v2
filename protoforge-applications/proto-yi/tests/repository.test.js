const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Repository } = require('../src/repository');
const { createStore } = require('../src/persistence');
const { EventBus, MemoryTransport } = require('../src/events/event-bus');

function createFakeAdapter(eventBus) {
  return {
    calls: [],
    async createProject(input) {
      this.calls.push({ method: 'createProject', input });
      const project = { project_id: 99, ...input };
      if (eventBus) eventBus.emit('project.created', project);
      return { ok: true, project };
    },
    async createTimeline(input) {
      this.calls.push({ method: 'createTimeline', input });
      return { ok: true, project_id: input.project_id, milestones: input.milestones.map(m => ({ milestone: m })) };
    },
    async health() {
      this.calls.push({ method: 'health' });
      return { ok: true, status: 'healthy' };
    }
  };
}

describe('Repository project orchestration', () => {
  it('delegates project creation to the adapter', async () => {
    const store = createStore({ type: 'memory' });
    const transport = new MemoryTransport();
    const eventBus = new EventBus([transport]);
    const adapter = createFakeAdapter(eventBus);
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const repo = new Repository(store, eventBus, logger, adapter);

    const project = await repo.createProject({ name: 'Test', category: 'test', owner_id: 1 });

    assert.strictEqual(project.project_id, 99);
    assert.strictEqual(project.name, 'Test');
    assert.strictEqual(adapter.calls.length, 1);
    assert.strictEqual(adapter.calls[0].method, 'createProject');
  });

  it('delegates timeline creation to the adapter', async () => {
    const store = createStore({ type: 'memory' });
    const transport = new MemoryTransport();
    const eventBus = new EventBus([transport]);
    const adapter = createFakeAdapter(eventBus);
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const repo = new Repository(store, eventBus, logger, adapter);

    const result = await repo.createTimeline({
      project_id: '7',
      milestones: ['A', 'B'],
      start_date: '2026-08-01',
      duration_days: 10
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.project_id, '7');
    assert.strictEqual(result.milestones.length, 2);
    assert.strictEqual(adapter.calls[0].method, 'createTimeline');
  });

  it('emits events through the shared event bus', async () => {
    const store = createStore({ type: 'memory' });
    const transport = new MemoryTransport();
    const eventBus = new EventBus([transport]);
    const adapter = createFakeAdapter(eventBus);
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const repo = new Repository(store, eventBus, logger, adapter);

    await repo.createProject({ name: 'Evented', category: 'test', owner_id: 2 });
    const emitted = transport.ofType('project.created');
    assert.strictEqual(emitted.length, 1);
    assert.strictEqual(emitted[0].payload.project_id, 99);
  });

  it('requires an adapter to create projects', async () => {
    const store = createStore({ type: 'memory' });
    const eventBus = new EventBus();
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const repo = new Repository(store, eventBus, logger, null);

    await assert.rejects(repo.createProject({ name: 'No Adapter' }), /adapter is not configured/);
  });
});
