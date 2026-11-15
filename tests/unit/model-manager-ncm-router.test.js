'use strict';

/**
 * Covers ModelManager optional intelligence-router path without paid/local inference.
 */

const VALID_JSON =
  '{"response":"Outline three steps to verify Heidi mobile pairing.","actions":[]}';

describe('ModelManager intelligence router hook', () => {
  const saved = {};

  beforeEach(() => {
    saved.HYDI_INTELLIGENCE_ROUTER = process.env.HYDI_INTELLIGENCE_ROUTER;
    saved.HYDI_ROUTER_TASK = process.env.HYDI_ROUTER_TASK;
    saved.HYDI_NCM_ENABLED = process.env.HYDI_NCM_ENABLED;
    saved.ENABLE_LOCAL_MODEL = process.env.ENABLE_LOCAL_MODEL;
    process.env.HYDI_INTELLIGENCE_ROUTER = '1';
    process.env.HYDI_ROUTER_TASK = 'planning';
    process.env.HYDI_NCM_ENABLED = '1';
    process.env.ENABLE_LOCAL_MODEL = 'false';
  });

  afterEach(() => {
    Object.assign(process.env, saved);
    global.fetch = undefined;
    jest.resetModules();
  });

  test('generateResponse uses NCM when router returns valid JSON', async () => {
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
        json: async () => ({ ok: true, text: VALID_JSON, metadata: { backend: 'mock' } }),
      });

    const { ModelManager } = await import('../../lib/ModelManager');
    const mm = new ModelManager();
    const res = await mm.generateResponse('Plan mobile pairing', 'sess-ncm-test', {
      recordMetrics: false,
    });
    expect(res.success).toBe(true);
    expect(res.model).toBe('ncm/experimental');
    expect(res.content).toBe(VALID_JSON);
  });

  test('generateResponse skips NCM when HYDI_INTELLIGENCE_ROUTER unset', async () => {
    delete process.env.HYDI_INTELLIGENCE_ROUTER;
    global.fetch = jest.fn().mockRejectedValue(new Error('ncm should not be called'));
    const { ModelManager } = await import('../../lib/ModelManager');
    const mm = new ModelManager();
    const res = await mm.generateResponse('hello', 'sess-off', { recordMetrics: false });
    expect(res).toBeDefined();
    expect(global.fetch.mock.calls.filter((c) => String(c[0]).includes('8791')).length).toBe(0);
  });
});