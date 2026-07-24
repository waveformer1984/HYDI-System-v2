'use strict';

const ModelProfile = require('../../../src/hydi-v3/ModelProfile');
const LoadBalancer = require('../../../src/hydi-v3/LoadBalancer');
const ModelPlacementEngine = require('../../../src/hydi-v3/ModelPlacementEngine');

describe('ModelProfile', () => {
  test('records runs and updates rolling estimates', () => {
    const p = new ModelProfile('llama3.2:3b');
    p.recordRun({ tokensPerSecond: 10, latencyMs: 100, peakVramBytes: 1_000_000 });
    p.recordRun({ tokensPerSecond: 20, latencyMs: 200, peakVramBytes: 2_000_000 });
    expect(p.tokensPerSecond).toBeGreaterThan(10);
    expect(p.latencyMs).toBeGreaterThan(0);
    expect(p.peakVramBytes).toBe(2_000_000);
  });

  test('records placements and tracks success/failure', () => {
    const p = new ModelProfile('test');
    p.recordPlacement({ gpuIndex: 0, runtime: 'ollama', success: true, latencyMs: 100, vramBytes: 1_000_000 });
    p.recordPlacement({ gpuIndex: 1, runtime: 'ollama', success: false, vramBytes: 1_000_000 });
    expect(p.successfulPlacements).toBe(1);
    expect(p.failedPlacements).toBe(1);
    expect(p.placements.length).toBe(2);
  });

  test('estimateMemory returns positive bytes', () => {
    const p = new ModelProfile('qwen2.5:7b');
    p.sizeBytes = 2_000_000_000;
    p.parameterCount = 7;
    p.quantization = 4;
    expect(p.estimateMemory(4096, 1)).toBeGreaterThan(0);
  });
});

describe('LoadBalancer', () => {
  function makeGpus() {
    return [
      { index: 0, vramBytes: 8e9, vramFreeBytes: 7e9, allocatedVramBytes: 0, utilizationGpu: 80, temperatureC: 75, isHealthy: true, cudaCapable: true },
      { index: 1, vramBytes: 8e9, vramFreeBytes: 6e9, allocatedVramBytes: 1e9, utilizationGpu: 20, temperatureC: 45, isHealthy: true, cudaCapable: true },
      { index: -1, vramBytes: Infinity, vramFreeBytes: Infinity, allocatedVramBytes: 0, utilizationGpu: 0, temperatureC: 0, isHealthy: true, isFallback: true },
    ];
  }

  test('least-loaded prefers low-utilization GPU', () => {
    const lb = new LoadBalancer('least-loaded');
    const ranked = lb.rank(makeGpus(), { vramBytes: 2e9 });
    expect(ranked[0].index).toBe(1);
  });

  test('vram-aware prefers GPU with enough free memory', () => {
    const lb = new LoadBalancer('vram-aware');
    const ranked = lb.rank(makeGpus(), { vramBytes: 6.5e9 });
    expect(ranked[0].index).toBe(0);
  });

  test('thermal-aware prefers coolest GPU', () => {
    const lb = new LoadBalancer('thermal-aware');
    const ranked = lb.rank(makeGpus(), { vramBytes: 1e9 });
    expect(ranked[0].index).toBe(1);
  });

  test('fallback is always ranked last', () => {
    const lb = new LoadBalancer('weighted');
    const ranked = lb.rank(makeGpus(), { vramBytes: 1e9 });
    expect(ranked[ranked.length - 1].isFallback).toBe(true);
  });
});

describe('ModelPlacementEngine', () => {
  function makeRuntime(name, available = true) {
    return {
      name,
      async health() { return { available, lastError: available ? null : 'down' }; },
      estimateMemory: (_modelName) => Promise.resolve(2_000_000_000),
      runInference: () => Promise.resolve('ok'),
    };
  }

  function makeGpus() {
    return [
      { index: 0, vramBytes: 8e9, vramFreeBytes: 7e9, allocatedVramBytes: 0, utilizationGpu: 10, temperatureC: 50, isHealthy: true, cudaCapable: true },
      { index: 1, vramBytes: 8e9, vramFreeBytes: 3e9, allocatedVramBytes: 4e9, utilizationGpu: 90, temperatureC: 85, isHealthy: true, cudaCapable: true },
      { index: -1, vramBytes: Infinity, vramFreeBytes: Infinity, allocatedVramBytes: 0, utilizationGpu: 0, temperatureC: 0, isHealthy: true, isFallback: true },
    ];
  }

  test('choosePlacement selects healthy runtime and GPU', async () => {
    const engine = new ModelPlacementEngine({ strategy: 'least-loaded' });
    const runtimes = new Map([['ollama', makeRuntime('ollama')]]);
    const gpus = makeGpus();
    const placement = await engine.choosePlacement({ model: 'llama3.2:3b' }, gpus, runtimes);
    expect(placement).not.toBeNull();
    expect(placement.runtime).toBe('ollama');
    expect(placement.gpu.index).toBe(0);
  });

  test('choosePlacement falls back to CPU when real GPUs are full', async () => {
    const engine = new ModelPlacementEngine({ strategy: 'vram-aware' });
    engine.registerProfile('huge', { sizeBytes: 10_000_000_000 });
    const runtimes = new Map([['ollama', makeRuntime('ollama')]]);
    const gpus = makeGpus();
    const placement = await engine.choosePlacement({ model: 'huge', options: { num_ctx: 4096 } }, gpus, runtimes);
    expect(placement).not.toBeNull();
    expect(placement.gpu.isFallback).toBe(true);
  });

  test('choosePlacement returns null if no runtime is available', async () => {
    const engine = new ModelPlacementEngine();
    const runtimes = new Map([['ollama', makeRuntime('ollama', false)]]);
    const gpus = makeGpus();
    const placement = await engine.choosePlacement({ model: 'x' }, gpus, runtimes);
    expect(placement).toBeNull();
  });

  test('strategy can be changed at runtime', () => {
    const engine = new ModelPlacementEngine({ strategy: 'least-loaded' });
    expect(engine.listStrategies()).toContain('thermal-aware');
    engine.setStrategy('thermal-aware');
    expect(engine.balancer.strategy).toBe('thermal-aware');
  });
});
