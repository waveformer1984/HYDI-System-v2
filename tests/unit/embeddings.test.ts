/**
 * Unit tests for lib/embeddings.ts — provider selection + dimension coercion.
 */

import {
  EMBEDDING_DIM,
  embeddingsAvailable,
  generateEmbedding,
  getEmbeddingProvider,
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
  });

  afterEach(() => {
    for (const k of EMBEDDING_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    global.fetch = realFetch;
  });

  describe('getEmbeddingProvider', () => {
    it('returns null when nothing is configured', () => {
      expect(getEmbeddingProvider()).toBeNull();
      expect(embeddingsAvailable()).toBe(false);
    });

    it('prefers openai when OPENAI_API_KEY is present', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      expect(getEmbeddingProvider()).toBe('openai');
      expect(embeddingsAvailable()).toBe(true);
    });

    it('falls back to ollama when a local model is enabled', () => {
      process.env.ENABLE_LOCAL_MODEL = 'true';
      expect(getEmbeddingProvider()).toBe('ollama');
    });

    it('honours an explicit EMBEDDING_PROVIDER=ollama even without a local flag', () => {
      process.env.EMBEDDING_PROVIDER = 'ollama';
      expect(getEmbeddingProvider()).toBe('ollama');
    });

    it('returns null for EMBEDDING_PROVIDER=openai with no key', () => {
      process.env.EMBEDDING_PROVIDER = 'openai';
      expect(getEmbeddingProvider()).toBeNull();
    });

    it('lets EMBEDDING_PROVIDER=openai win when a key exists, ignoring local flags', () => {
      process.env.EMBEDDING_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.ENABLE_LOCAL_MODEL = 'true';
      expect(getEmbeddingProvider()).toBe('openai');
    });
  });

  describe('generateEmbedding', () => {
    it('returns null when no provider is configured', async () => {
      expect(await generateEmbedding('hello')).toBeNull();
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

    it('passes through an OpenAI 1536-dim vector unchanged', async () => {
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
});
