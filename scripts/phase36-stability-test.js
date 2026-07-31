#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const BaseAdapter = require('../src/hydi-v3/BaseAdapter');
const ModelManager = require('../src/hydi-v3/ModelManager');
const ModelRuntimeManager = require('../src/hydi-v3/ModelRuntimeManager');
const ModelRouter = require('../src/hydi-v3/ModelRouter');
const EmbeddingManager = require('../src/hydi-v3/EmbeddingManager');
const SemanticMemoryIndex = require('../src/hydi-v3/SemanticMemoryIndex');
const MemoryMaintenanceService = require('../src/hydi-v3/MemoryMaintenanceService');
const ResourceManager = require('../src/hydi-v3/ResourceManager');
const ExecutionPolicy = require('../src/hydi-v3/ExecutionPolicy');
const RuntimeTelemetry = require('../src/hydi-v3/RuntimeTelemetry');

const silent = { log: () => {}, error: () => {}, warn: () => {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MockAdapter extends BaseAdapter {
  constructor() {
    super({ baseUrl: 'mock://local' });
    this.name = 'mock';
  }

  async health() { return { ok: true, status: 'ok' }; }
  async listModels() { return [{ id: 'mock/fast', name: 'mock/fast', provider: 'mock', capabilities: ['chat', 'embed'] }]; }
  async chat() { return { ok: true, text: 'ok' }; }
  async complete() { return { ok: true, text: 'ok' }; }
  async embed(text) {
    const v = Array.from({ length: 8 }, (_, i) => (String(text).length + i) % 7 / 10);
    return { ok: true, vector: v };
  }
}

async function main() {
  const durationMs = Number(process.env.DURATION_MS) || 60000;
  const targetHz = 10; // realistic cadence: 10 AI operations per second (10-50/s range)
  const targetInterval = 1000 / targetHz;
  const dataPath = path.join(os.tmpdir(), `hydi-p36-stability-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dataPath, { recursive: true });

  const mm = new ModelManager({ adapters: [new MockAdapter()], logger: silent });
  await mm.start();
  const runtime = new ModelRuntimeManager({ logger: silent });
  runtime.start();
  const router = new ModelRouter(mm, runtime, { logger: silent });

  const em = await new EmbeddingManager({ modelManager: mm, dataPath, storeFile: 'stability.json' }).start();
  const smi = new SemanticMemoryIndex({ embeddingManager: em, logger: silent });
  const maintenance = new MemoryMaintenanceService({ semanticMemory: smi, embeddingManager: em, logger: silent });
  const rm = new ResourceManager({ logger: silent });
  const policy = new ExecutionPolicy({ logger: silent });
  const telemetry = new RuntimeTelemetry({ dataPath, logger: silent });
  await telemetry.start();

  // Baseline memory after warm-up.
  if (global.gc) global.gc();
  await sleep(200);
  const baselineHeap = process.memoryUsage().heapUsed;
  let peakHeap = baselineHeap;
  const start = performance.now();
  let cycles = 0;
  const heapSnapshots = [];
  const gcCheckpointInterval = 100; // GC + idle checkpoint every 100 cycles (~10 s)

  while (performance.now() - start < durationMs) {
    const cycleStart = performance.now();
    const action = { type: cycles % 5 === 0 ? 'modify_file' : 'read_memory' };
    const authorize = policy.authorize(action);
    let result;
    let task;

    switch (cycles % 5) {
      case 0:
        task = 'intentExtraction';
        result = await router.extractIntent(`cycle ${cycles} status`);
        break;
      case 1:
        task = 'summarization';
        result = await router.summarize(`cycle ${cycles} document`);
        break;
      case 2:
        task = 'planning';
        result = await router.plan(`cycle ${cycles} plan`);
        break;
      case 3:
        task = 'embedding';
        result = await router.embed(`cycle ${cycles} vector`);
        break;
      default:
        task = 'rag';
        result = await router.ragAnswer(`cycle ${cycles} question`, []);
    }

    telemetry.record({
      task,
      selectedModel: result.usedModel || null,
      selectedAgent: 'StabilityTest',
      reasoning: `policy ${authorize.classification}`,
      confidence: 0.9,
      latency: performance.now() - cycleStart,
      outcome: result.ok === false || result.error ? 'error' : 'success',
      fallbackUsed: !result.usedModel,
      meta: { memDocs: em.list().length },
    });

    await smi.remember(`cycle ${cycles} ${task}`, { confidence: 0.7, source: 'stability' });
    await smi.recall(task, { limit: 3 });

    if (cycles % 20 === 0) {
      await maintenance.removeDuplicates();
      rm.snapshot();
    }

    cycles++;
    const currentHeap = process.memoryUsage().heapUsed;
    if (currentHeap > peakHeap) peakHeap = currentHeap;

    if (cycles % gcCheckpointInterval === 0 && global.gc) {
      // Repeated GC/idle checkpoint to distinguish transient growth from a leak.
      await sleep(200);
      global.gc();
      await sleep(200);
      heapSnapshots.push({ cycles, heapUsed: process.memoryUsage().heapUsed, at: Date.now() });
    }

    const nextCycleStart = start + cycles * targetInterval;
    const wait = Math.max(0, nextCycleStart - performance.now());
    if (wait > 0) await sleep(wait);
  }

  // Idle drain + final GC checkpoint.
  await sleep(1000);
  if (global.gc) {
    global.gc();
    await sleep(250);
    global.gc();
  }
  await sleep(500);

  await telemetry.stop();
  const finalHeap = process.memoryUsage().heapUsed;
  const heapGrowth = finalHeap - baselineHeap;
  const telemetrySize = (await fs.stat(telemetry.storePath)).size;
  const docCount = em.list().length;
  const queueDepth = Array.from(runtime.queues.values()).reduce((sum, q) => sum + q.length, 0);
  const activeCount = Array.from(runtime.active.values()).filter(Boolean).length;
  const recommendation = rm.recommendPlacement('simple_task', mm.registry.all());
  const retainedTelemetryEntries = telemetry.summary().total;
  const activeResources = typeof process.getActiveResourcesInfo === 'function' ? process.getActiveResourcesInfo() : [];
  const activeTimers = activeResources.filter((r) => (r && r.type === 'Timeout') || r === 'Timeout').length;

  await fs.rm(dataPath, { recursive: true, force: true });

  // Express leak assertion relative to baseline and workload, not a fixed threshold.
  const finalGrowthRatio = heapGrowth / Math.max(1, baselineHeap);
  const peakGrowthRatio = (peakHeap - baselineHeap) / Math.max(1, baselineHeap);
  const memoryGrowthOk = finalHeap <= baselineHeap * 1.10 + 1 * 1024 * 1024;
  const peakMemoryOk = peakHeap <= baselineHeap * 2.0 + 2 * 1024 * 1024;
  const noMonotonicLeak = heapSnapshots.length < 2
    || !heapSnapshots.every((s, i, a) => i === 0 || s.heapUsed >= a[i - 1].heapUsed);

  const result = {
    durationMs,
    targetHz,
    cycles,
    events: cycles,
    telemetrySize,
    docCount,
    baselineHeap,
    peakHeap,
    finalHeap,
    heapGrowth,
    heapGrowthPerCycle: heapGrowth / cycles,
    finalHeapGrowthRatio: finalGrowthRatio,
    peakHeapGrowthRatio: peakGrowthRatio,
    memoryGrowthOk,
    peakMemoryOk,
    noMonotonicLeak,
    queueDepth,
    activeCount,
    retainedTelemetryEntries,
    activeTimers,
    recommendation: recommendation ? recommendation.id : null,
    resourceSnapshot: rm.snapshot(),
    heapSnapshots,
    overall: memoryGrowthOk && peakMemoryOk && noMonotonicLeak && queueDepth === 0 && activeCount === 0 && retainedTelemetryEntries === 0 ? 'PASS' : 'FAIL',
  };

  console.log(JSON.stringify(result, null, 2));
  if (result.overall !== 'PASS') process.exit(1);
}

main().catch((e) => {
  console.error(JSON.stringify({ overall: 'FAIL', error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(1);
});
