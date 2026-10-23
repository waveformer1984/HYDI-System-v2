'use strict';

/**
 * paid-llm-gate — the $0 switch.
 *
 * These tests prove that with real-looking provider keys set but
 * HYDI_ALLOW_PAID_LLM unset/off, no code path sends a request to a paid
 * host. fetch, axios.post and https.request are all spied on; any call to
 * a paid host is a failure.
 */

jest.mock('../../heidi-core/brain/ollama-client', () =>
  jest.fn().mockImplementation(() => ({
    generate: jest.fn().mockResolvedValue({ response: 'mock' }),
    isAvailable: jest.fn().mockResolvedValue(true),
    getModels: jest.fn().mockResolvedValue([]),
  }))
);

const axios = require('axios');
const https = require('https');
const { isPaidLlmAllowed, paidApiKey, SWITCH_NAME } = require('../../lib/cost/paid-llm-gate.js');

const REAL_ANTHROPIC = 'sk-ant-' + 'a'.repeat(40);
const REAL_OPENAI = 'sk-' + 'b'.repeat(48);
const REAL_GEMINI = 'AIza' + 'c'.repeat(35);

const PAID_HOST = /anthropic\.com|openai\.com|googleapis\.com|openrouter\.ai|aimlapi\.com|groq\.com|elevenlabs\.io|replicate\.com/i;

const GATE_ENV_VARS = [
  'HYDI_ALLOW_PAID_LLM',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'EMBEDDING_PROVIDER',
];

let savedEnv;
let fetchSpy;
let axiosPostSpy;
let httpsRequestSpy;

function paidCalls() {
  const urls = [];
  for (const call of fetchSpy.mock.calls) urls.push(String(call[0]));
  for (const call of axiosPostSpy.mock.calls) urls.push(String(call[0]));
  for (const call of httpsRequestSpy.mock.calls) urls.push(String(call[0]?.hostname || call[0]));
  return urls.filter((u) => PAID_HOST.test(u));
}

beforeEach(() => {
  savedEnv = {};
  for (const name of GATE_ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  // Real-looking keys are set, as a hosting dashboard or stray .env would.
  process.env.ANTHROPIC_API_KEY = REAL_ANTHROPIC;
  process.env.OPENAI_API_KEY = REAL_OPENAI;
  process.env.GEMINI_API_KEY = REAL_GEMINI;

  fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], choices: [{ message: { content: 'ok' } }], data: [{ embedding: [0.1] }] }), { status: 200 }),
  );
  axiosPostSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: {} });
  httpsRequestSpy = jest.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('https.request must not be reached');
  });
});

afterEach(() => {
  for (const name of GATE_ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  jest.restoreAllMocks();
});

describe('isPaidLlmAllowed', () => {
  test('defaults to false when the switch is unset', () => {
    expect(isPaidLlmAllowed({})).toBe(false);
  });

  test("only the literal 'true' enables it", () => {
    expect(isPaidLlmAllowed({ [SWITCH_NAME]: 'true' })).toBe(true);
    expect(isPaidLlmAllowed({ [SWITCH_NAME]: ' TRUE ' })).toBe(true);
    for (const v of ['1', 'yes', 'on', 'false', '', 'TRUEEE']) {
      expect(isPaidLlmAllowed({ [SWITCH_NAME]: v })).toBe(false);
    }
  });
});

describe('paidApiKey', () => {
  test('returns undefined with the switch off even when a real key is set', () => {
    expect(paidApiKey('ANTHROPIC_API_KEY')).toBeUndefined();
    expect(paidApiKey('OPENAI_API_KEY')).toBeUndefined();
    expect(paidApiKey('GEMINI_API_KEY')).toBeUndefined();
  });

  test('returns the key only when the switch is on', () => {
    process.env.HYDI_ALLOW_PAID_LLM = 'true';
    expect(paidApiKey('ANTHROPIC_API_KEY')).toBe(REAL_ANTHROPIC);
  });

  test('ursula-frontend copy has identical gate behaviour', () => {
    const ursula = require('../../apps/ursula-frontend/src/lib/paid-llm-gate.js');
    expect(ursula.isPaidLlmAllowed({})).toBe(false);
    expect(ursula.isPaidLlmAllowed({ [SWITCH_NAME]: 'true' })).toBe(true);
    expect(ursula.paidApiKey('OPENAI_API_KEY', { OPENAI_API_KEY: REAL_OPENAI })).toBeUndefined();
    expect(ursula.paidApiKey('OPENAI_API_KEY', { HYDI_ALLOW_PAID_LLM: 'true', OPENAI_API_KEY: REAL_OPENAI })).toBe(REAL_OPENAI);
  });
});

describe('call sites do not reach paid hosts when the switch is off', () => {
  test('api/local-model.js tryCloudFallback returns null without an axios call', async () => {
    const { HeidiLocalHandler } = require('../../api/local-model.js');
    const handler = new HeidiLocalHandler();
    const result = await handler.tryCloudFallback('hello', null);
    expect(result).toBeNull();
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(paidCalls()).toEqual([]);
  });

  test('pao-system LLMService throws before fetching Anthropic or OpenAI', async () => {
    const { LLMService } = require('../../pao-system/services/llm.service');
    await expect(new LLMService().generateText('hi')).rejects.toThrow(/No LLM provider configured/);
    expect(paidCalls()).toEqual([]);
  });

  test('lib/embeddings.ts falls back to the no-provider path with EMBEDDING_PROVIDER=openai', async () => {
    process.env.EMBEDDING_PROVIDER = 'openai';
    const { generateEmbedding, getEmbeddingProvider } = require('../../lib/embeddings');
    expect(getEmbeddingProvider()).toBeNull();
    await expect(generateEmbedding('some text')).resolves.toBeNull();
    expect(paidCalls()).toEqual([]);
  });

  test('src/healing/SelfHealingService returns null without an https request', async () => {
    const SelfHealingService = require('../../src/healing/SelfHealingService.js');
    const svc = new SelfHealingService();
    await expect(svc.diagnoseAndCorrect({ issue: 'x' })).resolves.toBeNull();
    await expect(svc.healFromCrash(new Error('boom'))).resolves.toBeNull();
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });

  test('src/models/HybridModelStack has no usable external keys', () => {
    const HybridModelStack = require('../../src/models/HybridModelStack.js');
    const stack = new HybridModelStack();
    expect(stack.externalModels.openai.apiKey).toBeUndefined();
    expect(stack.externalModels.anthropic.apiKey).toBeUndefined();
    expect(stack.externalModels.gemini.apiKey).toBeUndefined();
  });

  test('src/models/local-model-adapter has no usable Gemini key', async () => {
    const LocalModelAdapter = require('../../src/models/local-model-adapter');
    const adapter = new LocalModelAdapter({ autoInitialize: false });
    try {
      expect(adapter.cloudFailover.geminiApiKey).toBeUndefined();
    } finally {
      if (typeof adapter.destroy === 'function') await adapter.destroy();
    }
  });
});

describe('when the switch IS on, keys flow through (gate is the only change)', () => {
  test('paidApiKey returns the key and LLMService reaches the mocked endpoint', async () => {
    process.env.HYDI_ALLOW_PAID_LLM = 'true';
    const { LLMService } = require('../../pao-system/services/llm.service');
    await new LLMService().generateText('hi');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('cost-audit switch reporting', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { main, effectiveSwitch } = require('../../scripts/cost-audit');

  function tmpRepo(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-audit-gate-'));
    for (const [rel, body] of Object.entries(files)) {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    }
    return root;
  }

  test('effectiveSwitch reports unset as off, and reads process env', () => {
    const root = tmpRepo({});
    expect(effectiveSwitch(root, {}).allowed).toBe(false);
    expect(effectiveSwitch(root, { [SWITCH_NAME]: 'true' }).allowed).toBe(true);
  });

  test('effectiveSwitch reads the switch from .env files', () => {
    const root = tmpRepo({ '.env.local': `${SWITCH_NAME}=true\n` });
    expect(effectiveSwitch(root, {}).allowed).toBe(true);
  });

  test('--strict exits 1 when the switch is true, 0 when off', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const root = tmpRepo({});
    expect(main(['--strict'], { [SWITCH_NAME]: 'true' }, root)).toBe(1);
    expect(main(['--strict'], {}, root)).toBe(0);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
