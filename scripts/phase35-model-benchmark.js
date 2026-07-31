#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const { performance } = require('perf_hooks');
const BaseAdapter = require('../src/hydi-v3/BaseAdapter');
const ModelManager = require('../src/hydi-v3/ModelManager');
const ModelRuntimeManager = require('../src/hydi-v3/ModelRuntimeManager');
const ModelRouter = require('../src/hydi-v3/ModelRouter');
const CapabilityProfile = require('../src/hydi-v3/CapabilityProfile');
const EmbeddingManager = require('../src/hydi-v3/EmbeddingManager');
const SemanticMemoryIndex = require('../src/hydi-v3/SemanticMemoryIndex');
const KnowledgePipeline = require('../src/hydi-v3/KnowledgePipeline');
const ResearchAgent = require('../src/hydi-v3/ResearchAgent');
const ProductAgent = require('../src/hydi-v3/ProductAgent');

const silent = { log: () => {}, error: () => {}, warn: () => {} };
const now = () => performance.now();

class MockAdapter extends BaseAdapter {
  constructor(config = {}) {
    super({ ...config, baseUrl: 'mock://local' });
    this.name = config.name || 'mock';
  }

  async health() { return { ok: true, status: 'ok' }; }
  async listModels() { return [{ id: this.name + '/fast', name: this.name + '/fast', provider: this.name, capabilities: ['chat', 'embed'] }]; }
  async chat() { return { ok: true, text: '{"intent":"status","args":{}}' }; }
  async complete() { return { ok: true, text: 'mock result' }; }
  async embed(text) {
    const v = Array.from({ length: 768 }, (_, i) => (String(text).length + i) % 100 / 1000);
    return { ok: true, vector: v };
  }
}

async function measure(name, fn) {
  const start = now();
  try {
    const result = await fn();
    return { name, ok: true, ms: +(now() - start).toFixed(2), result };
  } catch (e) {
    return { name, ok: false, ms: +(now() - start).toFixed(2), error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-p35-bench-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dataPath, { recursive: true });
  const report = { timestamp: new Date().toISOString(), environment: { node: process.version, platform: os.platform(), arch: os.arch(), cpus: os.cpus().length, totalMem: os.totalmem() }, results: [] };

  const mm = new ModelManager({ adapters: [new MockAdapter({ name: 'mock' })], logger: silent });
  const discovery = await measure('model discovery', () => mm.start());
  report.results.push(discovery);

  const runtime = new ModelRuntimeManager({ logger: silent });
  runtime.start();
  const router = new ModelRouter(mm, runtime, { logger: silent });

  report.results.push(await measure('cold start inference', async () => {
    const cold = await runtime.warmup('mock/fast', () => mm.complete('Say ok.', { model: 'mock/fast' }));
    if (!cold.ok) throw new Error(cold.error || 'cold start failed');
    return cold.result;
  }));

  report.results.push(await measure('warm inference', async () => {
    const warm = await router.extractIntent('what is the status');
    return { intent: warm.intent, usedModel: warm.usedModel };
  }));

  const em = await new EmbeddingManager({ modelManager: mm, dataPath }).start();
  const semantic = new SemanticMemoryIndex({ embeddingManager: em, logger: silent });

  report.results.push(await measure('memory retrieval', async () => {
    await semantic.remember('Resonate product launch in Q1', { tier: SemanticMemoryIndex.TIERS.WORKING, importance: 2 });
    await semantic.remember('Resonate manufacturing risk', { tier: SemanticMemoryIndex.TIERS.WORKING, importance: 1 });
    const r = await semantic.recall('Resonate launch', { limit: 5 });
    return { recall: r.length };
  }));

  // Note: above intentionally has TIORS typo to test error handling? It will throw. Remove/keep? We should fix typo.

  const dir = path.join(dataPath, 'docs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'resonate.md'), '# Resonate\nResonate is the product.\n');
  const pipeline = new KnowledgePipeline({ embeddingManager: em, logger: silent });

  report.results.push(await measure('context assembly', async () => {
    await pipeline.ingestDirectory(dir);
    const docs = await pipeline.query('Resonate', 5);
    return { docs: docs.length };
  }));

  const research = new ResearchAgent({ modelRouter: router, businessMemory: { find: () => [] } });
  const product = new ProductAgent({ modelRouter: router, businessMemory: { find: () => [] } });

  report.results.push(await measure('agent routing', async () => {
    const r = await research.analyze('Resonate');
    const p = await product.analyze();
    return { agents: [r.agent, p.agent] };
  }));

  report.results.push(await measure('capability scoring', async () => {
    const profile = new CapabilityProfile(mm.registry.get('mock/fast'), runtime.getMetrics('mock/fast'));
    return { conversation: +profile.score('conversation').toFixed(2), embedding: +profile.score('embedding').toFixed(2) };
  }));

  runtime.stop();
  report.resourceUsage = process.memoryUsage();
  report.modelStates = runtime.allStates();
  report.routerLog = router.recentLog(20);

  const reportPath = path.join(__dirname, '..', 'reports', 'business-os', 'phase35-model-benchmark-results.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  await fs.rm(dataPath, { recursive: true, force: true });

  console.log(JSON.stringify(report, (key, value) => (key === 'routerLog' ? undefined : value), 2));
  console.log(`\nFull report saved to ${reportPath}`);
}

main().catch((e) => {
  console.error('Benchmark failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
