/**
 * EMBEDDINGS LAYER
 *
 * Produces real semantic embeddings for Heidi's memory system.
 * The `memories` table stores vector(1536), which matches OpenAI's
 * text-embedding-3-small / ada-002 dimensionality.
 *
 * Returns `null` when no embedding provider is configured or a call fails,
 * so callers degrade gracefully (store memory without an embedding and skip
 * semantic retrieval) instead of writing a degenerate constant vector.
 */

export const EMBEDDING_DIM = 1536;

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

/**
 * Generate a real embedding for the given text.
 * @returns a 1536-dim vector, or null if embeddings are unavailable.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // No provider configured — caller must handle null (no semantic memory).
    return null;
  }

  const input = (text || '').trim();
  if (!input) return null;

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    });

    if (!response.ok) {
      throw new Error(`Embeddings API error: ${response.status}`);
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    const embedding = data.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Embeddings API returned no vector');
    }
    return embedding;
  } catch (error) {
    console.error('[Embeddings] Generation failed:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Whether a real embedding provider is configured.
 */
export function embeddingsAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
