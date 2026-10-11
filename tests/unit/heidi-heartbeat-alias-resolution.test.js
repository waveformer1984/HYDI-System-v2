'use strict';

// Regression coverage: UrsulaModelHeartbeat monitors some models under service-name
// aliases ('document-summarizer', 'sentiment-analyzer') that LocalModelAdapter never
// actually registers -- only the real backing ids ('local-llama', 'local-classifier')
// get loaded. Both the health check and recovery paths resolve the alias to its real
// model id via resolveModelId() before touching the adapter.
//
// Health checks are NON-GENERATIVE: they never call adapter.execute() (which would
// reach POST /api/generate and load/evict real models just to mark them healthy).
// Ollama-backed configs are probed via GET /api/tags + GET /api/ps; adapter-backed
// configs via the adapter's loaded-model registry.

// heartbeat.js exports a singleton instance (not the class), so every test shares it --
// reset its mutable state between tests to keep them isolated.
const heartbeat = require('../../src/models/heartbeat');

beforeEach(() => {
  heartbeat.adapter = null;
  heartbeat.failedModels.clear();
});

function makeMockAdapter({ installed = [{ name: 'qwen2.5-coder:1.5b', size: 986000000 }], resident = ['qwen2.5-coder:1.5b'] } = {}) {
  const modelConfigs = {
    'local-llama': { type: 'llama' },
    'local-classifier': { type: 'classifier' },
  };
  const models = new Map([
    ['local-llama', { loaded: true }],
    ['local-classifier', { loaded: true }],
  ]);
  const ollamaGet = jest.fn(async (url) => {
    if (url === '/api/tags') return { data: { models: installed } };
    if (url === '/api/ps') return { data: { models: resident.map(name => ({ name })) } };
    throw new Error(`unexpected GET ${url}`);
  });
  return {
    modelConfigs,
    models,
    ollamaClient: { client: { get: ollamaGet } },
    ollamaGet,
    execute: jest.fn(async (modelId) => {
      if (!models.has(modelId) || !models.get(modelId).loaded) {
        throw new Error(`Model ${modelId} not loaded`);
      }
      return { text: 'ok', confidence: 0.9 };
    }),
    unloadModel: jest.fn(async (modelId) => {
      models.delete(modelId);
    }),
    loadModel: jest.fn(async (modelId, config) => {
      models.set(modelId, { loaded: true, config });
    }),
  };
}

describe('UrsulaModelHeartbeat.resolveModelId', () => {
  test('resolves known service-name aliases to their real backing model id', () => {
    expect(heartbeat.resolveModelId('document-summarizer')).toBe('local-llama');
    expect(heartbeat.resolveModelId('sentiment-analyzer')).toBe('local-classifier');
  });

  test('passes through ids that are not aliases unchanged', () => {
    expect(heartbeat.resolveModelId('gpt-4-local')).toBe('gpt-4-local');
    expect(heartbeat.resolveModelId('totally-unknown-model')).toBe('totally-unknown-model');
  });
});

describe('UrsulaModelHeartbeat.getTestInputForModel', () => {
  test('does not infinitely recurse for an id that is neither a known model nor an alias', () => {
    expect(() => heartbeat.getTestInputForModel('totally-unknown-model')).not.toThrow();
    expect(heartbeat.getTestInputForModel('totally-unknown-model')).toEqual({ task: 'Health check ping' });
  });

  test('resolves an alias to its backing model test input', () => {
    expect(heartbeat.getTestInputForModel('document-summarizer')).toEqual(
      heartbeat.getTestInputForModel('local-llama')
    );
  });
});

describe('UrsulaModelHeartbeat.checkSingleModelHealth with an aliased model', () => {
  test('probes non-generatively via the resolved real model config and reports healthy', async () => {
    heartbeat.adapter = makeMockAdapter();

    const result = await heartbeat.checkSingleModelHealth('document-summarizer');

    // 'document-summarizer' -> 'local-llama' (type 'llama' -> Ollama-backed):
    // the check must use inventory endpoints only, never adapter.execute().
    expect(heartbeat.adapter.execute).not.toHaveBeenCalled();
    expect(heartbeat.adapter.ollamaGet).toHaveBeenCalledWith('/api/tags', expect.anything());
    expect(result.modelId).toBe('document-summarizer');
    expect(result.healthy).toBe(true);
    expect(result.details.state).toBe('resident');
  });

  test('reports installed-but-not-resident as healthy, separately from unavailable', async () => {
    heartbeat.adapter = makeMockAdapter({ resident: [] });

    const result = await heartbeat.checkSingleModelHealth('document-summarizer');

    expect(result.healthy).toBe(true);
    expect(result.details.state).toBe('installed-not-resident');
  });

  test('reports unavailable when Ollama is unreachable', async () => {
    heartbeat.adapter = makeMockAdapter();
    heartbeat.adapter.ollamaGet.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await heartbeat.checkSingleModelHealth('document-summarizer');

    expect(result.healthy).toBe(false);
    expect(result.details.state).toBe('unavailable');
    expect(result.details.reason).toMatch(/ollama unreachable/);
  });

  test('reports unavailable when no generative model is installed', async () => {
    heartbeat.adapter = makeMockAdapter({ installed: [{ name: 'nomic-embed-text:latest', size: 274000000 }] });

    const result = await heartbeat.checkSingleModelHealth('document-summarizer');

    expect(result.healthy).toBe(false);
    expect(result.details.state).toBe('unavailable');
    expect(result.details.reason).toMatch(/no generative model installed/);
  });

  test('checks non-Ollama adapter models against the loaded registry without executing', async () => {
    heartbeat.adapter = makeMockAdapter();

    const result = await heartbeat.checkSingleModelHealth('sentiment-analyzer');

    // 'sentiment-analyzer' -> 'local-classifier' (type 'classifier' -> adapter-backed):
    // no Ollama calls, no execute — just the loaded registry.
    expect(heartbeat.adapter.execute).not.toHaveBeenCalled();
    expect(heartbeat.adapter.ollamaGet).not.toHaveBeenCalled();
    expect(result.modelId).toBe('sentiment-analyzer');
    expect(result.healthy).toBe(true);
    expect(result.details.state).toBe('resident');
  });
});

describe('UrsulaModelHeartbeat.recoverFailedModels with an aliased model', () => {
  test('reloads the real backing model instead of logging "No configuration found"', async () => {
    heartbeat.adapter = makeMockAdapter();
    heartbeat.failedModels.set('document-summarizer', 3);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    try {
      await heartbeat.recoverFailedModels(['document-summarizer']);
    } finally {
      errorSpy.mockRestore();
    }

    expect(heartbeat.adapter.loadModel).toHaveBeenCalledWith('local-llama', expect.anything());
    expect(heartbeat.failedModels.has('document-summarizer')).toBe(false);

    const noConfigLogged = errorSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('No configuration found'))
    );
    expect(noConfigLogged).toBe(false);
  });
});
