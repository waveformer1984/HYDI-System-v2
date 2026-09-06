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
});
