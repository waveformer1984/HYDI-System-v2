'use strict';

const { capability, createResponse, resolveMode } = require('../../lib/providers/openai-adapter');

describe('OpenAI adapter (mock-first)', () => {
  test('default mode is mock without paid switch', async () => {
    const env = { OPENAI_API_KEY: 'sk-test', HYDI_ALLOW_PAID_LLM: 'false' };
    expect(resolveMode(env)).toBe('mock');
    const cap = capability(env);
    expect(cap.live_allowed).toBe(false);
    expect(cap.mode).toBe('mock');
  });

  test('mock response never calls network', async () => {
    const out = await createResponse({ input: 'hello hydi' }, { HYDI_ALLOW_PAID_LLM: 'false' });
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('mock');
    expect(out.classification).toBe('VERIFIED_SIMULATED');
    expect(out.output_text).toContain('mock-openai');
  });

  test('live mode blocked without operator approval', async () => {
    const env = { HYDI_OPENAI_ADAPTER_MODE: 'live', OPENAI_API_KEY: 'sk-test', HYDI_ALLOW_PAID_LLM: 'false' };
    const out = await createResponse({ input: 'test' }, env);
    expect(out.ok).toBe(false);
    expect(out.error).toBe('paid_llm_disabled');
    expect(out.classification).toBe('REQUIRES_OPERATOR_APPROVAL');
  });
});