/**
 * HEIDI MEMORY LAYER (shared)
 *
 * Semantic long-term memory backed by Supabase pgvector. Used by both the
 * streaming agent (lib/heidi-agent.ts) and the legacy orchestrator
 * (lib/orchestrator.ts) so retrieval/storage behaviour stays in one place.
 *
 * Degrades gracefully when no embedding provider is configured: retrieval
 * returns '' and storage writes null embeddings instead of failing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding } from './embeddings';

/**
 * Retrieve relevant prior context via semantic search over the user message.
 */
export async function retrieveMemory(
  supabase: SupabaseClient,
  message: string,
  userId: string,
): Promise<string> {
  try {
    const embedding = await generateEmbedding(message);
    if (!embedding) return '';

    const { data } = await supabase.rpc('search_memories', {
      query_embedding: embedding,
      match_count: 5,
      user_id: userId,
    });

    if (!data || data.length === 0) return '';

    const context = (data as Array<{ content: string }>).map((m) => m.content).join('\n');
    return `Previous relevant context:\n${context}`;
  } catch (error) {
    console.error('[HeidiMemory] retrieval failed:', error instanceof Error ? error.message : 'Unknown error');
    return '';
  }
}

/**
 * Persist the user message and assistant response as memories.
 */
export async function storeMemory(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  try {
    const [userEmbedding, assistantEmbedding] = await Promise.all([
      generateEmbedding(userMessage),
      generateEmbedding(assistantResponse),
    ]);

    const { error } = await supabase.from('memories').insert([
      { user_id: userId, session_id: sessionId, content: `User: ${userMessage}`, embedding: userEmbedding },
      { user_id: userId, session_id: sessionId, content: `Assistant: ${assistantResponse}`, embedding: assistantEmbedding },
    ]);
    if (error) {
      // supabase-js returns errors in-band; without this the write fails silently.
      console.error('[HeidiMemory] insert failed:', error.message);
    }
  } catch (error) {
    console.error('[HeidiMemory] storage failed:', error instanceof Error ? error.message : 'Unknown error');
  }
}
