#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const BaseAdapter = require('../src/hydi-v3/BaseAdapter');
const ModelManager = require('../src/hydi-v3/ModelManager');
const ModelRuntimeManager = require('../src/hydi-v3/ModelRuntimeManager');
const CapabilityProfile = require('../src/hydi-v3/CapabilityProfile');
const KnowledgePipeline = require('../src/hydi-v3/KnowledgePipeline');
const EmbeddingManager = require('../src/hydi-v3/EmbeddingManager');
const SemanticMemoryIndex = require('../src/hydi-v3/SemanticMemoryIndex');
const ModelRouter = require('../src/hydi-v3/ModelRouter');
const { STATES } = require('../src/hydi-v3/ModelRuntimeManager');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

function assert(ok, message, details) {
  if (!ok) throw new Error(`${message} ${JSON.stringify(details || {})}`);
}

class MockAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({ ...config, baseUrl: 'mock://local' });
    this.name = config.name || 'mock';
  }

  async health() { return { ok: true, status: 'ok' }; }
  async listModels() { return [{ id: this.name + '/fast', name: this.name + '/fast', provider: this.name, capabilities: ['chat', 'embed'] }]; }
  async chat() { return { ok: true, text: '{"intent":"status","args":{}}' }; }
  async complete() { return { ok: true, text: 'mock completion' }; }
  async embed(text) {
    const v = Array.from({ length: 8 }, (_, i) => (String(text).length + i) % 7 / 10);
    return { ok: true, vector: v };
  }
}

async function run() {
  const dataPath = path.join(os.tmpdir(), `hydi-p35-validate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dataPath, { recursive: true });
  const results = { sections: [] };

  // --- ModelRuntimeManager ---
  {
    const runtime = new ModelRuntimeManager({ logger: silent });
    runtime.register('mock/fast');
    assert(runtime.getState('mock/fast') === STATES.UNAVAILABLE, 'Initial state should be UNAVAILABLE');

    const warmup = await runtime.warmup('mock/fast', () => Promise.resolve('ok'));
    assert(warmup.ok, 'Warmup should succeed', warmup);
    assert(runtime.getState('mock/fast') === STATES.READY, 'After warmup should be READY', { state: runtime.getState('mock/fast') });

    const req = await runtime.request('mock/fast', 'test', () => Promise.resolve({ text: 'done' }));
    assert(req.ok, 'Request should succeed', req);
    assert(runtime.getMetrics('mock/fast').calls === 1, 'Should record 1 call', runtime.getMetrics('mock/fast'));

    const fail = await runtime.request('mock/fast', 'fail', () => Promise.reject(new Error('boom')));
    assert(!fail.ok, 'Should record failure', fail);
    assert(runtime.getMetrics('mock/fast').errors === 1, 'Should record 1 error', runtime.getMetrics('mock/fast'));
    runtime.stop();
    results.sections.push({ component: 'ModelRuntimeManager', passed: true });
  }

  // --- CapabilityProfile + ModelRouter routing ---
  {
    const mm = new ModelManager({ adapters: [new MockAdapter({ name: 'mock' })], logger: silent });
    const report = await mm.start();
    const cp = new CapabilityProfile(mm.registry.get('mock/fast'), { calls: 10, errors: 0, lastLatency: 50 });
    assert(cp.supports('chat'), 'Mock should support chat');
    assert(cp.score('conversation') > 0, 'Chat model should score conversation positively');
    assert(cp.score('embedding') > cp.score('vision'), 'Embed model should score embedding higher than vision');

    const runtime = new ModelRuntimeManager({ logger: silent });
    runtime.start();
    const router = new ModelRouter(mm, runtime, { logger: silent });
    const selected = router._selectModel('intentExtraction', true);
    assert(selected && selected.model === 'mock/fast', 'Router should select mock fast', selected);
    runtime.stop();
    results.sections.push({ component: 'CapabilityProfile+ModelRouter', passed: true, providers: report.providers.length });
  }

  // --- KnowledgePipeline ---
  {
    const mm = new ModelManager({ adapters: [new MockAdapter({ name: 'mock' })], logger: silent });
    await mm.start();
    const em = await new EmbeddingManager({ modelManager: mm, dataPath, storeFile: 'knowledge.json' }).start();
    const pipeline = new KnowledgePipeline({ embeddingManager: em, logger: silent });

    const dir = path.join(dataPath, 'docs');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'a.md'), '# Resonate\nResonate is the flagship product.\n');
    await fs.writeFile(path.join(dir, 'b.txt'), 'Other product notes.\n');

    const ingest = await pipeline.ingestDirectory(dir);
    assert(ingest.indexed > 0, 'Should index documents', ingest);

    const q = await pipeline.query('Resonate', 3);
    assert(q.length > 0, 'Should retrieve documents', { count: q.length });

    await em.persist();
    results.sections.push({ component: 'KnowledgePipeline', passed: true, indexed: ingest.indexed, retrieved: q.length });
  }

  // --- SemanticMemoryIndex ---
  {
    const mm = new ModelManager({ adapters: [new MockAdapter({ name: 'mock' })], logger: silent });
    await mm.start();
    const storeFile = 'semantic.json';
    const em = await new EmbeddingManager({ modelManager: mm, dataPath, storeFile }).start();
    const index = new SemanticMemoryIndex({ embeddingManager: em, logger: silent });

    await index.remember('Launch Resonate in Q1', { tier: SemanticMemoryIndex.TIERS.EXECUTIVE, importance: 2 });
    await index.remember('Fix printer calibration', { tier: SemanticMemoryIndex.TIERS.WORKING, importance: 1 });
    const recall = await index.recall('Resonate launch', { limit: 5 });
    assert(recall.length > 0, 'Should recall executive memory', { recall: recall.length });
    assert(recall[0].meta.tier === 'EXECUTIVE', 'Executive tier should rank high', recall[0].meta);

    // Persistence/recovery
    await em.persist();
    const em2 = await new EmbeddingManager({ modelManager: mm, dataPath, storeFile }).start();
    assert(em2.list().length === em.list().length, 'Should recover persisted memories', { before: em.list().length, after: em2.list().length });

    results.sections.push({ component: 'SemanticMemoryIndex', passed: true, count: em.list().length });
  }

  // --- Cleanup ---
  await fs.rm(dataPath, { recursive: true, force: true });

  results.overall = 'PASS';
  console.log(JSON.stringify(results, null, 2));
  return results;
}

run().then((r) => {
  if (r.overall === 'PASS') process.exit(0);
  process.exit(1);
}).catch((e) => {
  console.error(JSON.stringify({ overall: 'FAIL', error: e.message }, null, 2));
  process.exit(1);
});
