'use strict';

const {
  SURFACES,
  resolveInferenceRoute,
  detectRouteConflicts,
  listInferenceSurfaces,
} = require('../../lib/heidi/inference-route');

describe('inference-route registry (audit only — execution unchanged)', () => {
  test('lists all surfaces with provider metadata', () => {
    const routes = listInferenceSurfaces({ HYDI_ALLOW_PAID_LLM: 'false' });
    expect(routes.length).toBeGreaterThanOrEqual(7);
    const ncm = routes.find((r) => r.surface === SURFACES.HYDI_NCM_EXPERIMENTAL);
    expect(ncm.enabled).toBe(false);
    expect(ncm.fallback.provider).toBe('ollama');
    const core = routes.find((r) => r.surface === SURFACES.HEIDI_CORE_CHAT_TOOLS);
    expect(core.primary.provider).toBe('ollama');
  });

  test('paid gate off disables anthropic primary', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
    process.env.HYDI_ALLOW_PAID_LLM = 'false';
    const r = resolveInferenceRoute(SURFACES.ANTHROPIC_AGENT);
    expect(r.enabled).toBe(false);
    expect(r.primary).toBeNull();
    delete process.env.ANTHROPIC_API_KEY;
  });

  test('detectRouteConflicts notes parallel brains when local enabled', () => {
    const conflicts = detectRouteConflicts({ ENABLE_LOCAL_MODEL: '1', HYDI_ALLOW_PAID_LLM: 'false' });
    expect(conflicts.some((c) => c.kind === 'parallel_chat_brains')).toBe(true);
  });
});