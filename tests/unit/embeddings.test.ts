/**
 * Unit tests for lib/embeddings.ts — provider selection + dimension coercion.
 */

import {
  EMBEDDING_DIM,
  embeddingsAvailable,
  generateEmbedding,
  getEmbeddingProvider,
  _resetEmbeddingCircuit,
} from '../../lib/embeddings';

const EMBEDDING_ENV_KEYS = [
  'OPENAI_API_KEY',
  'EMBEDDING_PROVIDER',
  'ENABLE_LOCAL_MODEL',
  'LOCAL_MODEL_URL',
  'OLLAMA_URL',
];

describe('lib/embeddings', () => {
  let savedEnv: Record<string, string | undefined>;
  const realFetch = global.fetch;

  beforeEach(() => {
    savedEnv = {};
    for (const k of EMBEDDING_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    _resetEmbeddingCircuit();
  });

  afterEach(() => {
    for (const k of EMBEDDING_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    global.fetch = realFetch;
  });

  describe('getEmbeddingProvider', () => {
    it('defaults to ollama when nothing is configured — local-first', () => {
      expect(getEmbeddingProvider()).toBe('ollama');
      expect(embeddingsAvailable()).toBe(true);
    });

    it('does NOT silently route to a cloud provider because a key is ambient', () => {
      // THE contract: a credential's presence is not consent to send memory
      // text through it. Even a real-looking key must not make openai the
      // provider without an explicit EMBEDDING_PROVIDER=openai.
      process.env.OPENAI_API_KEY = 'sk-test';
      expect(getEmbeddingProvider()).toBe('ollama');
      expect(embeddingsAvailable()).toBe(true);
    });

    it('a placeholder-looking ambient key is equally ignored', () => {
      process.env.OPENAI_API_KEY = 'sk-your-openai-key';
      expect(getEmbeddingProvider()).toBe('ollama');
    });

    it('uses ollama when a local model is enabled', () => {
      process.env.ENABLE_LOCAL_MODEL = 'true';
      expect(getEmbeddingProvider()).toBe('ollama');
    });

    it('honours an explicit EMBEDDING_PROVIDER=ollama', () => {
      process.env.EMBEDDING_PROVIDER = 'ollama';
      expect(getEmbeddingProvider()).toBe('ollama');
    });

    it('EMBEDDING_PROVIDER=none disables embeddings explicitly', () => {
      process.env.EMBEDDING_PROVIDER = 'none';
      expect(getEmbeddingProvider()).toBeNull();
      expect(embeddingsAvailable()).toBe(false);
    });

    it('returns null for EMBEDDING_PROVIDER=openai with no key', () => {
      process.env.EMBEDDING_PROVIDER = 'openai';
      expect(getEmbeddingProvider()).toBeNull();
    });

    it('lets EMBEDDING_PROVIDER=openai opt in when a key exists — the only cloud path', () => {
      process.env.EMBEDDING_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.ENABLE_LOCAL_MODEL = 'true';
      expect(getEmbeddingProvider()).toBe('openai');
    });
  });

  describe('generateEmbedding', () => {
    it('returns null when embeddings are explicitly disabled — without any fetch', async () => {
      process.env.EMBEDDING_PROVIDER = 'none';
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      expect(await generateEmbedding('hello')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('an ambient OPENAI_API_KEY never causes a cloud call — traffic goes to local Ollama', async () => {
      // The defect this locks against: OPENAI_API_KEY present in env used to
      // silently send memory text to api.openai.com. With only the ambient
      // key set, the request must go to the LOCAL Ollama endpoint.
      process.env.OPENAI_API_KEY = 'sk-test';
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await generateEmbedding('memory text');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('localhost:11434/api/embeddings'),
        expect.anything(),
      );
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.stringContaining('api.openai.com'),
        expect.anything(),
      );
    });

    it('returns null for empty/whitespace input', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      expect(await generateEmbedding('   ')).toBeNull();
    });

    it('zero-pads a short Ollama vector to EMBEDDING_DIM (cosine-preserving)', async () => {
      process.env.EMBEDDING_PROVIDER = 'ollama';
      const short = Array.from({ length: 768 }, (_, i) => (i + 1) / 1000);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: short }),
      }) as unknown as typeof fetch;

      const vec = await generateEmbedding('hello world');
      expect(vec).not.toBeNull();
      expect(vec).toHaveLength(EMBEDDING_DIM);
      expect(vec!.slice(0, 768)).toEqual(short);
      expect(vec!.slice(768).every((x) => x === 0)).toBe(true);
    });

    it('passes through an OpenAI 1536-dim vector unchanged — only via explicit opt-in', async () => {
      process.env.EMBEDDING_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';
      const full = Array.from({ length: EMBEDDING_DIM }, () => 0.5);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: full }] }),
      }) as unknown as typeof fetch;

      const vec = await generateEmbedding('hello');
      expect(vec).toHaveLength(EMBEDDING_DIM);
      expect(vec).toEqual(full);
    });

    it('returns null (degrades) when the provider call fails', async () => {
      process.env.EMBEDDING_PROVIDER = 'ollama';
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
      expect(await generateEmbedding('hello')).toBeNull();
    });

    it('calls the configured Ollama base URL', async () => {
      process.env.EMBEDDING_PROVIDER = 'ollama';
      process.env.LOCAL_MODEL_URL = 'http://example:11434';
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await generateEmbedding('hi');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://example:11434/api/embeddings',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('circuit breaker — a dead provider must not starve the loop', () => {
    it('opens after 3 consecutive failures: subsequent calls fail fast without fetch', async () => {
      process.env.EMBEDDING_PROVIDER = 'ollama';
      process.env.EMBEDDING_CIRCUIT_COOLDOWN_MS = '60000';
      const fetchMock = jest.fn().mockRejectedValue(new Error('wedged'));
      global.fetch = fetchMock as unknown as typeof fetch;

      for (let i = 0; i < 3; i++) {
        expect(await generateEmbedding('text')).toBeNull();
      }
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Circuit open — calls 4..6 return null instantly, no fetch
      for (let i = 0; i < 3; i++) {
        expect(await generateEmbedding('text')).toBeNull();
      }
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('half-open probe after cooldown: success closes the circuit', async () => {
      process.env.EMBEDDING_PROVIDER = 'ollama';
      process.env.EMBEDDING_CIRCUIT_COOLDOWN_MS = '1'; // 1ms — cooldown lapses immediately
      const fetchMock = jest.fn()
        .mockRejectedValueOnce(new Error('x'))
        .mockRejectedValueOnce(new Error('x'))
        .mockRejectedValueOnce(new Error('x'))
        .mockResolvedValue({ ok: true, json: async () => ({ embedding: [0.1, 0.2] }) });
      global.fetch = fetchMock as unknown as typeof fetch;

      for (let i = 0; i < 3; i++) await generateEmbedding('t');   // open
      await new Promise(r => setTimeout(r, 5));                  // cooldown lapse
      const vec = await generateEmbedding('t');                  // half-open probe
      expect(vec).not.toBeNull();                                 // circuit closed
      expect(fetchMock).toHaveBeenCalledTimes(4);
      await generateEmbedding('t');
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });
});
