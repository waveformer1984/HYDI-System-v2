'use strict';

const { HeidiLocalHandler } = require('../../api/local-model');

describe('Heidi chat pipeline — local mock mode', () => {
  const oldEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...oldEnv };
  });

  it('completes a message without cloud API calls', async () => {
    process.env.LOCAL_MODEL_PROVIDER = 'mock';
    process.env.LOCAL_MODEL_NAME = 'mock-heidi';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    process.env.SUPABASE_URL = '';

    const heidi = new HeidiLocalHandler();
    const result = await heidi.handleMessage('What is the system status?');

    expect(result.text).toContain('[Heidi mock]');
    expect(result.provider).toBe('mock');
    expect(result.fallback).toBeUndefined();
    expect(result.model).toBe('mock-heidi');
  });

  it('falls back safely when Ollama is unavailable and no cloud keys are set', async () => {
    process.env.LOCAL_MODEL_PROVIDER = 'ollama';
    process.env.LOCAL_MODEL_URL = 'http://127.0.0.1:11434';
    process.env.LOCAL_MODEL_TIMEOUT_MS = '500';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';

    const heidi = new HeidiLocalHandler();
    const result = await heidi.handleMessage('status check');

    expect(result.text).toContain('I\'m having trouble');
    expect(result.fallback).toBe(true);
    expect(result.error).toMatch(/ENOTFOUND|ECONNREFUSED|timeout/);
  });

  it('does not leak real keys to cloud fallback', async () => {
    process.env.LOCAL_MODEL_PROVIDER = 'ollama';
    process.env.LOCAL_MODEL_URL = 'http://127.0.0.1:11434';
    process.env.LOCAL_MODEL_TIMEOUT_MS = '100';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';

    const heidi = new HeidiLocalHandler();
    const result = await heidi.handleMessage('hello');

    expect(result.fallback).toBe(true);
    expect(result.provider).toBe('ollama');
    expect(result.text).toBeTruthy();
  });
});
