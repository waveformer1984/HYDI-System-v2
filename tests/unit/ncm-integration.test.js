'use strict';

const { ENGINES, completeWithRouter } = require('../../lib/inference/intelligence-router');
const { generateViaNcm, probeNcmHealth } = require('../../lib/inference/ncm-client');

describe('NCM integration (mocked HTTP)', () => {
  const env = {
    HYDI_NCM_ENABLED: '1',
    HYDI_INTELLIGENCE_ROUTER: '1',
    HYDI_NCM_SERVICE_URL: 'http://127.0.0.1:8791',
  };

  afterEach(() => {
    global.fetch = undefined;
  });

  test('probeNcmHealth parses healthy sidecar', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, mode: 'mock' }),
    });
    const h = await probeNcmHealth(env);
    expect(h.ok).toBe(true);
    expect(h.mode).toBe('mock');
  });

  test('generateViaNcm returns text on 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, text: 'refined plan', metadata: { backend: 'mock' } }),
    });
    const g = await generateViaNcm({ prompt: 'plan', task: 'planning' }, env);
    expect(g.ok).toBe(true);
    expect(g.text).toBe('refined plan');
    expect(g.engine).toBe('ncm');
  });

  test('completeWithRouter uses NCM when healthy', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, mode: 'mock' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, text: 'ncm output', metadata: {} }),
      });
    const out = await completeWithRouter(
      { prompt: 'outline tasks', task: 'planning' },
      async () => ({ content: 'never', success: true }),
      env,
    );
    expect(out.engine).toBe(ENGINES.NCM);
    expect(out.content).toBe('ncm output');
    expect(out.router.fallback_to_llm).toBe(false);
  });
});