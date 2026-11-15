'use strict';

const {
  selectEngine,
  describeRouter,
  completeWithRouter,
  NCM_ELIGIBLE_TASKS,
  ENGINES,
} = require('../../lib/inference/intelligence-router');

describe('intelligence-router', () => {
  test('defaults to LLM when NCM disabled', () => {
    const s = selectEngine({ task: 'planning', env: { HYDI_NCM_ENABLED: '0' } });
    expect(s.engine).toBe(ENGINES.LLM);
    expect(s.reason).toBe('ncm_disabled');
    expect(s.ncm_eligible).toBe(true);
  });

  test('selects NCM for eligible task when enabled', () => {
    const s = selectEngine({
      task: 'summarization',
      env: { HYDI_NCM_ENABLED: '1', HYDI_INTELLIGENCE_ROUTER: '1' },
    });
    expect(s.engine).toBe(ENGINES.NCM);
    expect(NCM_ELIGIBLE_TASKS).toContain('summarization');
  });

  test('conversation stays on LLM even when NCM enabled', () => {
    const s = selectEngine({
      task: 'conversation',
      env: { HYDI_NCM_ENABLED: '1', HYDI_INTELLIGENCE_ROUTER: '1' },
    });
    expect(s.engine).toBe(ENGINES.LLM);
  });

  test('describeRouter documents experimental posture', () => {
    const d = describeRouter({ HYDI_NCM_ENABLED: '0' });
    expect(d.schema_version).toBe(1);
    expect(d.ncm_enabled).toBe(false);
    expect(d.note).toMatch(/benchmark-ncm-integration/);
  });

  test('completeWithRouter falls back to LLM when NCM health fails', async () => {
    const original = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));
    const out = await completeWithRouter(
      { prompt: 'plan steps', task: 'planning' },
      async () => ({ content: 'llm ok', success: true, model: 'local' }),
      { HYDI_NCM_ENABLED: '1', HYDI_INTELLIGENCE_ROUTER: '1' },
    );
    global.fetch = original;
    expect(out.engine).toBe(ENGINES.LLM);
    expect(out.content).toBe('llm ok');
    expect(out.router.fallback_to_llm).toBe(true);
  });
});