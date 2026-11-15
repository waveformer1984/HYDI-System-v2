'use strict';

const { ENGINES, completeWithRouter, selectEngine, describeRouter } = require('../../lib/inference/intelligence-router');
const { generateViaNcm, probeNcmHealth } = require('../../lib/inference/ncm-client');
const { ENGINES: ENGINE_IDS, NCM_ELIGIBLE_TASKS } = require('../../lib/inference/engines');
const { maybeCompleteViaIntelligenceRouter } = require('../../lib/inference/model-manager-router-bridge');
const { buildNcmBenchmarkReport } = require('../../scripts/benchmark-ncm-integration');

const VALID_JSON =
  '{"response":"Plan verify mobile pairing on Frank with status then chat.","actions":[]}';

describe('inference engines registry', () => {
  test('exports frozen engine ids and task lists', () => {
    expect(ENGINE_IDS.NCM).toBe('ncm');
    expect(NCM_ELIGIBLE_TASKS).toContain('draft_outline');
  });
});

describe('NCM client edge cases', () => {
  const env = { HYDI_NCM_SERVICE_URL: 'http://127.0.0.1:8791' };

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = undefined;
  });

  test('probeNcmHealth handles HTTP 503', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const h = await probeNcmHealth(env);
    expect(h.ok).toBe(false);
    expect(h.error).toBe('HTTP 503');
  });

  test('probeNcmHealth handles abort/timeout errors', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(err);
    const h = await probeNcmHealth(env, 100);
    expect(h.ok).toBe(false);
    expect(h.error).toMatch(/aborted/i);
  });

  test('generateViaNcm handles malformed JSON body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('invalid json');
      },
    });
    const g = await generateViaNcm({ prompt: 'x', task: 'planning' }, env);
    expect(g.ok).toBe(false);
  });

  test('generateViaNcm handles ok:false from sidecar', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: 'ncm_not_ready' }),
    });
    const g = await generateViaNcm({ prompt: 'x', task: 'planning' }, env);
    expect(g.ok).toBe(false);
    expect(g.error).toBe('ncm_not_ready');
  });

  test('generateViaNcm network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const g = await generateViaNcm({ prompt: 'x', task: 'planning' }, env);
    expect(g.ok).toBe(false);
    expect(g.error).toMatch(/ECONNRESET/);
  });
});

describe('intelligence router paths', () => {
  const baseEnv = { HYDI_NCM_ENABLED: '1', HYDI_INTELLIGENCE_ROUTER: '1' };

  afterEach(() => {
    global.fetch = undefined;
  });

  test('routes memory tasks to memory engine', () => {
    const s = selectEngine({ task: 'memory_search', env: baseEnv });
    expect(s.engine).toBe(ENGINES.MEMORY);
  });

  test('routes agent tasks to agent engine', () => {
    const s = selectEngine({ task: 'agent_execute', env: baseEnv });
    expect(s.engine).toBe(ENGINES.AGENT);
  });

  test('router_explicitly_off', () => {
    const s = selectEngine({
      task: 'planning',
      env: { ...baseEnv, HYDI_INTELLIGENCE_ROUTER: '0' },
    });
    expect(s.reason).toBe('router_explicitly_off');
    expect(s.engine).toBe(ENGINES.LLM);
  });

  test('falls back when generate fails after healthy probe', async () => {
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
        json: async () => ({ ok: false, error: 'official_generate_not_wired' }),
      });
    const out = await completeWithRouter(
      { prompt: 'plan', task: 'planning' },
      async () => ({ content: 'fallback body', success: true }),
      baseEnv,
    );
    expect(out.engine).toBe(ENGINES.LLM);
    expect(out.content).toBe('fallback body');
    expect(out.router.ncm_error).toMatch(/official_generate|ncm_generate/);
  });

  test('describeRouter with NCM enabled', () => {
    const d = describeRouter(baseEnv);
    expect(d.ncm_enabled).toBe(true);
    expect(d.intelligence_router).toBe(true);
  });

  test('unknown task falls back to default llm reason', () => {
    const s = selectEngine({ task: 'weird_custom_task', env: baseEnv });
    expect(s.reason).toBe('unknown_task_fallback_llm');
    expect(s.engine).toBe(ENGINES.LLM);
  });

  test('conversation does not probe NCM', async () => {
    global.fetch = jest.fn();
    const out = await completeWithRouter(
      { prompt: 'hi', task: 'conversation' },
      async () => ({ content: 'llm-only', success: true }),
      baseEnv,
    );
    expect(out.engine).toBe(ENGINES.LLM);
    expect(out.content).toBe('llm-only');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('model-manager router bridge', () => {
  test('returns null when router env off', async () => {
    const r = await maybeCompleteViaIntelligenceRouter('p', {}, async () => ({
      content: 'x',
      success: true,
    }));
    expect(r).toBeNull();
  });

  test('delegates when router on', async () => {
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
        json: async () => ({ ok: true, text: VALID_JSON }),
      });
    const r = await maybeCompleteViaIntelligenceRouter(
      'plan',
      { HYDI_INTELLIGENCE_ROUTER: '1', HYDI_ROUTER_TASK: 'planning', HYDI_NCM_ENABLED: '1' },
      async () => ({ content: 'never', success: true }),
    );
    expect(r.engine).toBe(ENGINES.NCM);
    expect(r.content).toBe(VALID_JSON);
    global.fetch = undefined;
  });
});

describe('benchmark report builder', () => {
  afterEach(() => {
    global.fetch = undefined;
  });

  test('buildNcmBenchmarkReport marks blocked without NCM', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    const report = await buildNcmBenchmarkReport({
      HYDI_NCM_ENABLED: '1',
      HYDI_INTELLIGENCE_ROUTER: '1',
    });
    expect(report.schema_version).toBe(1);
    expect(report.blocked).toBe(true);
    expect(report.cases.length).toBeGreaterThan(0);
  });

  test('buildNcmBenchmarkReport records routed engine when NCM is up', async () => {
    global.fetch = jest
      .fn()
      .mockImplementation((url, init) => {
        const u = String(url);
        if (u.includes('/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, mode: 'mock' }),
          });
        }
        if (u.includes('/v1/generate')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, text: 'plan outline', metadata: {} }),
          });
        }
        if (u.includes('/api/tags')) {
          return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
        }
        return Promise.reject(new Error(`unexpected ${u}`));
      });
    const report = await buildNcmBenchmarkReport({
      HYDI_NCM_ENABLED: '1',
      HYDI_INTELLIGENCE_ROUTER: '1',
    });
    expect(report.probes.ncm.ok).toBe(true);
    expect(report.cases[0].routed.engine).toBe('ncm');
    expect(report.blocked).toBe(true);
  });
});

describe('NCM integration (mocked HTTP) — happy paths', () => {
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

  test('completeWithRouter falls back when health fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));
    const out = await completeWithRouter(
      { prompt: 'plan steps', task: 'planning' },
      async () => ({ content: 'llm ok', success: true, model: 'local' }),
      env,
    );
    expect(out.engine).toBe(ENGINES.LLM);
    expect(out.router.fallback_to_llm).toBe(true);
  });
});