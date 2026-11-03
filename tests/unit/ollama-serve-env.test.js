'use strict';
const { ollamaServeEnv } = require('../../lib/operational/RecoveryEngine');

describe('ollamaServeEnv', () => {
  it('binds loopback only', () => {
    expect(ollamaServeEnv().OLLAMA_HOST).toBe('127.0.0.1:11434');
  });
  it('carries the MemoryOps limits', () => {
    const e = ollamaServeEnv();
    expect(e.OLLAMA_MAX_LOADED_MODELS).toBe('1');
    expect(e.OLLAMA_CONTEXT_LENGTH).toBe('4096');
    expect(e.OLLAMA_NUM_PARALLEL).toBe('1');
    expect(e.OLLAMA_KEEP_ALIVE).toBe('2m');
  });
  it('preserves the rest of the caller env', () => {
    const e = ollamaServeEnv();
    const key = Object.keys(process.env)[0];
    expect(e[key]).toBe(process.env[key]);
  });
});
