/**
 * EMBEDDINGS LAYER
 *
 * Produces real semantic embeddings for Heidi's memory system.
 * The `memories` table stores vector(1536), which matches OpenAI's
 * text-embedding-3-small / ada-002 dimensionality.
 *
 * Two providers are supported:
 *  - `openai`  — hosted embeddings (default when OPENAI_API_KEY is set).
 *  - `ollama`  — local, zero-cost embeddings (e.g. nomic-embed-text). Local
 *    models emit fewer dimensions (768/1024); the vector is zero-padded to
 *    EMBEDDING_DIM. Zero-padding preserves cosine similarity (the extra zero
 *    components contribute nothing to the dot product or either norm), so it
 *    is safe for pgvector cosine search against 1536-dim rows.
 *
 * Returns `null` when no provider is configured or a call fails, so callers
 * degrade gracefully (store memory without an embedding and skip semantic
 * retrieval) instead of writing a degenerate constant vector.
 */

import structuredLogger from './structured-logger';

const logger = structuredLogger.child({ component: 'Embeddings' });

export const EMBEDDING_DIM = 1536;

const OPENAI_EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

type EmbeddingProvider = 'openai' | 'ollama' | null;

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

function ollamaBaseUrl(): string {
  return process.env.LOCAL_MODEL_URL || process.env.OLLAMA_URL || 'http://localhost:11434';
}

/**
 * Resolve which embedding provider to use. An explicit EMBEDDING_PROVIDER wins;
 * otherwise prefer OpenAI when its key is present, then fall back to Ollama when
 * a local model is enabled.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  const explicit = (process.env.EMBEDDING_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'openai') return process.env.OPENAI_API_KEY ? 'openai' : null;
  if (explicit === 'ollama') return 'ollama';

  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ENABLE_LOCAL_MODEL === 'true' || process.env.LOCAL_MODEL_URL || process.env.OLLAMA_URL) {
    return 'ollama';
  }
  return null;
}

/**
 * Coerce a provider vector to exactly EMBEDDING_DIM: zero-pad if shorter
 * (cosine-preserving), truncate if longer.
 */
function toEmbeddingDim(vector: number[]): number[] {
  if (vector.length === EMBEDDING_DIM) return vector;
  if (vector.length > EMBEDDING_DIM) return vector.slice(0, EMBEDDING_DIM);
  return vector.concat(new Array(EMBEDDING_DIM - vector.length).fill(0));
}

async function generateOpenAIEmbedding(input: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI embeddings API error: ${response.status}`);
  }

  const data = (await response.json()) as OpenAIEmbeddingResponse;
  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('OpenAI embeddings API returned no vector');
  }
  return toEmbeddingDim(embedding);
}

async function generateOllamaEmbedding(input: string): Promise<number[] | null> {
  const response = await fetch(`${ollamaBaseUrl()}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_EMBEDDING_MODEL, prompt: input }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embeddings API error: ${response.status}`);
  }

  const data = (await response.json()) as OllamaEmbeddingResponse;
  const embedding = data.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Ollama embeddings API returned no vector');
  }
  return toEmbeddingDim(embedding);
}

/**
 * Generate a real embedding for the given text.
 * @returns a 1536-dim vector, or null if embeddings are unavailable.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const provider = getEmbeddingProvider();
  if (!provider) {
    // No provider configured — caller must handle null (no semantic memory).
    return null;
  }

  const input = (text || '').trim();
  if (!input) return null;

  try {
    return provider === 'ollama'
      ? await generateOllamaEmbedding(input)
      : await generateOpenAIEmbedding(input);
  } catch (error) {
    logger.error('Generation failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    return null;
  }
}

/**
 * Whether a real embedding provider is configured.
 */
export function embeddingsAvailable(): boolean {
  return getEmbeddingProvider() !== null;
}
