'use strict';

// Regression coverage: UrsulaModelHeartbeat monitors some models under service-name
// aliases ('document-summarizer', 'sentiment-analyzer') that LocalModelAdapter never
// actually registers -- only the real backing ids ('local-llama', 'local-classifier')
// get loaded. Every health check called adapter.execute(alias, ...), which always threw
// "Model <alias> not loaded", and every recovery attempt looked up
// adapter.modelConfigs[alias], which was always undefined, logging
// "[HEARTBEAT] No configuration found for model: <alias>" forever. Both paths now resolve
// the alias to its real model id via resolveModelId() before touching the adapter.

// heartbeat.js exports a singleton instance (not the class), so every test shares it --
// reset its mutable state between tests to keep them isolated.
const heartbeat = require('../../src/models/heartbeat');

beforeEach(() => {
  heartbeat.adapter = null;
  heartbeat.failedModels.clear();
});

function makeMockAdapter() {
  const modelConfigs = {
    'local-llama': { type: 'llama' },
    'local-classifier': { type: 'classifier' },
  };
  const models = new Map([
    ['local-llama', { loaded: true }],
    ['local-classifier', { loaded: true }],
  ]);
  return {
    modelConfigs,
    models,
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
  test('executes against the resolved real model id, not the alias, and reports healthy', async () => {
    heartbeat.adapter = makeMockAdapter();

    const result = await heartbeat.checkSingleModelHealth('document-summarizer');

    expect(heartbeat.adapter.execute).toHaveBeenCalledWith(
      'local-llama',
      expect.anything(),
      expect.objectContaining({ tier: 'starter' })
    );
    expect(result.modelId).toBe('document-summarizer');
    expect(result.healthy).toBe(true);
  });
});

describe('UrsulaModelHeartbeat.recoverFailedModels with an aliased model', () => {
  test('reloads the real backing model instead of logging "No configuration found"', async () => {
    heartbeat.adapter = makeMockAdapter();
    heartbeat.failedModels.set('document-summarizer', 3);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
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
