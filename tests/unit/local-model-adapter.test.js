'use strict';

const LocalModelAdapter = require('../../src/models/local-model-adapter');

describe('LocalModelAdapter cleanup', () => {
  let adapter;

  afterEach(() => {
    if (adapter && typeof adapter.destroy === 'function') {
      return adapter.destroy();
    }
    adapter = null;
  });

  test('constructor starts monitoring intervals', () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: true });
    expect(adapter.systemMonitoringInterval).toBeTruthy();
    expect(adapter.hungModelMonitorInterval).toBeTruthy();
  });

  test('destroy clears all intervals, timers, and child processes', async () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: true });
    await adapter.destroy();
    expect(adapter.systemMonitoringInterval).toBeNull();
    expect(adapter.hungModelMonitorInterval).toBeNull();
    expect(adapter.batchTimer).toBeNull();
    expect(adapter.modelProcesses.size).toBe(0);
    expect(adapter._destroyed).toBe(true);
  });
});

// Regression coverage for the "spawn ./bin/main ENOENT" incident: llama-type
// models (gpt-4-local, gpt-35-turbo, local-llama) must run inference through
// the already-working Ollama backend, not a never-shipped llama.cpp binary.
describe('LocalModelAdapter Llama inference (Ollama-backed)', () => {
  let adapter;

  afterEach(async () => {
    if (adapter) await adapter.destroy();
    adapter = null;
  });

  test('executeLlama resolves via OllamaClient instead of failing with ENOENT', async () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: false });
    await adapter.loadModel('gpt-4-local', adapter.modelConfigs['gpt-4-local']);

    const result = await adapter.executeLlama('gpt-4-local', 'hello', {});

    // Text/confidence only come back this way if OllamaClient.generate() was
    // actually invoked -- a real './bin/main' spawn would reject with ENOENT
    // before any of this shape could be produced.
    expect(result.text).toBe('mock ollama response');
    expect(result.confidence).toBe(0.85);
    expect(typeof result.tokens).toBe('number');
  });

  test('runLlamaInference surfaces a diagnosable error when Ollama itself fails', async () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: false });
    jest.spyOn(adapter.ollamaClient, 'generate').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      adapter.runLlamaInference('/config/path/unused', { prompt: 'x', temperature: 0.5, maxTokens: 10 })
    ).rejects.toThrow(/Ollama inference failed for model/);
  });

  test('every llama-type model config routes through Ollama, not a model-specific binary', async () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: false });
    const llamaModelIds = Object.entries(adapter.modelConfigs)
      .filter(([, config]) => config.type === 'llama' || config.type === 'codellama')
      .map(([modelId]) => modelId);

    expect(llamaModelIds).toEqual(expect.arrayContaining(['gpt-4-local', 'gpt-35-turbo', 'local-llama']));

    for (const modelId of llamaModelIds) {
      await adapter.loadModel(modelId, adapter.modelConfigs[modelId]);
      const result = await adapter.executeLlama(modelId, 'ping', {});
      expect(result.text).toBe('mock ollama response');
    }
  });

  // Regression coverage: this Ollama deployment only serves one request at a time
  // (OLLAMA_MAX_LOADED_MODELS=1, OLLAMA_NUM_PARALLEL=1), but nothing client-side used to
  // reflect that -- concurrent callers (the heartbeat monitor alone fires ~6 in parallel
  // every 30s) all fired generate() simultaneously and each raced its own timeout against
  // an invisible internal queue. runLlamaInference now serializes via this._ollamaQueue.
  test('runLlamaInference serializes concurrent calls against the single-slot Ollama backend', async () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: false });

    let inFlight = 0;
    let maxInFlight = 0;
    const completionOrder = [];
    jest.spyOn(adapter.ollamaClient, 'generate').mockImplementation(async (prompt) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      completionOrder.push(prompt);
      inFlight--;
      return { text: `response for ${prompt}` };
    });

    const results = await Promise.all([
      adapter.runLlamaInference('/x', { prompt: 'a', temperature: 0.5, maxTokens: 10 }),
      adapter.runLlamaInference('/x', { prompt: 'b', temperature: 0.5, maxTokens: 10 }),
      adapter.runLlamaInference('/x', { prompt: 'c', temperature: 0.5, maxTokens: 10 }),
    ]);

    expect(maxInFlight).toBe(1); // never more than one generate() call in flight at once
    expect(completionOrder).toEqual(['a', 'b', 'c']); // executed in submission order
    expect(results.map((r) => r.output)).toEqual(['response for a', 'response for b', 'response for c']);
  });

  test('a rejected call does not poison the queue for callers behind it', async () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: false });

    jest.spyOn(adapter.ollamaClient, 'generate')
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ text: 'still works' });

    const first = adapter.runLlamaInference('/x', { prompt: 'a', temperature: 0.5, maxTokens: 10 });
    const second = adapter.runLlamaInference('/x', { prompt: 'b', temperature: 0.5, maxTokens: 10 });

    await expect(first).rejects.toThrow(/Ollama inference failed for model/);
    await expect(second).resolves.toEqual(expect.objectContaining({ output: 'still works' }));
  });

  // Regression coverage for the "heartbeat evicts the chat model" incident: this
  // Ollama deployment holds only one loaded model at a time (OLLAMA_MAX_LOADED_MODELS=1).
  // runLlamaInference used to default to the literal 'llama3', while the live chat path
  // (lib/ModelManager.ts's getLocalModelName()) defaults to 'llama3.2:3b' -- two different
  // model tags. Every ~30s heartbeat sweep (which calls every alias in modelConfigs, all
  // routed through here) would load 'llama3' and evict whatever the chat path had warm,
  // so the next real chat message paid a full cold-load (measured at 37s for llama3.2:3b
  // alone). The default here must match ModelManager's exactly.
  describe('runLlamaInference model resolution matches lib/ModelManager.ts exactly', () => {
    const ENV_KEYS = ['LOCAL_MODEL_NAME', 'OLLAMA_MODEL'];
    let savedEnv;

    beforeEach(() => {
      savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
      for (const k of ENV_KEYS) delete process.env[k];
    });

    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    });

    async function modelPassedToOllama(overrides) {
      adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: false });
      const spy = jest.spyOn(adapter.ollamaClient, 'generate').mockResolvedValue({ text: 'ok' });
      await adapter.runLlamaInference('/unused', { prompt: 'x', temperature: 0.5, maxTokens: 10, ...overrides });
      return spy.mock.calls[0][1].model;
    }

    test('defaults to llama3.2:3b (matching ModelManager.getLocalModelName default) when no env vars are set', async () => {
      await expect(modelPassedToOllama({})).resolves.toBe('llama3.2:3b');
    });

    test('LOCAL_MODEL_NAME takes priority over OLLAMA_MODEL, matching ModelManager', async () => {
      process.env.LOCAL_MODEL_NAME = 'qwen2.5:7b';
      process.env.OLLAMA_MODEL = 'llama3';
      await expect(modelPassedToOllama({})).resolves.toBe('qwen2.5:7b');
    });

    test('falls back to OLLAMA_MODEL when LOCAL_MODEL_NAME is unset', async () => {
      process.env.OLLAMA_MODEL = 'llama3.2:latest';
      await expect(modelPassedToOllama({})).resolves.toBe('llama3.2:latest');
    });

    test('an explicit params.ollamaModel still wins over both env vars', async () => {
      process.env.LOCAL_MODEL_NAME = 'qwen2.5:7b';
      await expect(modelPassedToOllama({ ollamaModel: 'tinyllama' })).resolves.toBe('tinyllama');
    });
  });
});

// Regression coverage: trackLatency() used a hardcoded 3000ms "DEGRADED" threshold sized
// for a backend that can run calls in parallel. This Ollama deployment serializes to a
// single concurrent slot, so normal queued latency routinely exceeds 3s with nothing
// actually wrong -- the threshold is now configurable with a more realistic default.
describe('LocalModelAdapter latency degraded threshold is configurable', () => {
  let adapter;
  const ENV_KEY = 'LOCAL_MODEL_LATENCY_DEGRADED_MS';

  afterEach(async () => {
    delete process.env[ENV_KEY];
    if (adapter) await adapter.destroy();
    adapter = null;
  });

  test('defaults to 6000ms (raised from the old hardcoded 3000ms)', () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: false });
    expect(adapter.latencyDegradedThresholdMs).toBe(6000);
  });

  test('a constructor option overrides the default', () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: false, latencyDegradedThresholdMs: 9999 });
    expect(adapter.latencyDegradedThresholdMs).toBe(9999);
  });

  test('an env var overrides the default when no constructor option is given', () => {
    process.env[ENV_KEY] = '12345';
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: false });
    expect(adapter.latencyDegradedThresholdMs).toBe(12345);
  });

  test('trackLatency uses the configured threshold instead of a hardcoded 3000ms', () => {
    adapter = new LocalModelAdapter({ autoInitialize: false, startMonitoring: false, latencyDegradedThresholdMs: 5000 });
    const events = [];
    adapter.on('latency_logged', (e) => events.push(e));

    // 4000ms would have been misreported as DEGRADED under the old hardcoded 3000ms
    // threshold; with a sane 5000ms threshold it's correctly HEALTHY.
    adapter.trackLatency('gpt-4-local', 4000);
    expect(events[0].status).toBe('HEALTHY');

    adapter.trackLatency('gpt-4-local', 6000);
    expect(events[1].status).toBe('DEGRADED');
  });
});
