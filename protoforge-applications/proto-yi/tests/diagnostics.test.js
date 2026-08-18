const { describe, it } = require('node:test');
const assert = require('node:assert');
const { collectDiagnostics } = require('../src/diagnostics');
const { Repository } = require('../src/repository');
const { createStore } = require('../src/persistence');
const { EventBus } = require('../src/events/event-bus');

function createFakeAdapter(reachable) {
  return {
    async health() {
      if (reachable) return { ok: true, status: 'ursula-epm-online', endpoint: 'http://test' };
      return { ok: false, status: 'unreachable', endpoint: 'http://test', error: 'engine down' };
    }
  };
}

describe('Diagnostics', () => {
  it('reports adapter configured, engine reachable, manifest loaded, and capabilities', async () => {
    const store = createStore({ type: 'memory' });
    const eventBus = new EventBus();
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const repo = new Repository(store, eventBus, logger, createFakeAdapter(true));

    const diag = await collectDiagnostics(repo);

    assert.strictEqual(diag.ok, true);
    assert.strictEqual(diag.status, 'ok');
    assert.strictEqual(diag.manifest.loaded, true);
    assert.ok(diag.manifest.capabilities.length > 0);
    assert.strictEqual(diag.engine.configured, true);
    assert.strictEqual(diag.engine.reachable, true);
    assert.strictEqual(diag.engine.status, 'ursula-epm-online');
  });

  it('reports degraded when the engine is unreachable', async () => {
    const store = createStore({ type: 'memory' });
    const eventBus = new EventBus();
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const repo = new Repository(store, eventBus, logger, createFakeAdapter(false));

    const diag = await collectDiagnostics(repo);

    assert.strictEqual(diag.ok, false);
    assert.strictEqual(diag.status, 'degraded');
    assert.strictEqual(diag.engine.reachable, false);
    assert.strictEqual(diag.engine.status, 'unreachable');
    assert.strictEqual(diag.engine.reason, 'engine down');
  });
});
