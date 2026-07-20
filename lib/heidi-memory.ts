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
 *
 * Skips rows that already exist verbatim for this (user_id, session_id) pair —
 * e.g. a retried request or a duplicate chat submission — so the table doesn't
 * accumulate identical rows and embeddings aren't regenerated needlessly.
 */
export async function storeMemory(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  try {
    const candidates = [
      { content: `User: ${userMessage}`, text: userMessage },
      { content: `Assistant: ${assistantResponse}`, text: assistantResponse },
    ];

    let existingContents = new Set<string>();
    try {
      const { data: existing } = await supabase
        .from('memories')
        .select('content')
        .eq('user_id', userId)
        .eq('session_id', sessionId)
        .in(
          'content',
          candidates.map((c) => c.content),
        );
      existingContents = new Set((existing || []).map((row: { content: string }) => row.content));
    } catch (dedupError) {
      // Dedup check is best-effort; if it fails, fall through and store normally.
      console.error(
        '[HeidiMemory] dedup check failed:',
        dedupError instanceof Error ? dedupError.message : 'Unknown error',
      );
    }

    const toStore = candidates.filter((c) => !existingContents.has(c.content));
    if (toStore.length === 0) return;

    const embeddings = await Promise.all(toStore.map((c) => generateEmbedding(c.text)));

    const { error } = await supabase.from('memories').insert(
      toStore.map((c, i) => ({
        user_id: userId,
        session_id: sessionId,
        content: c.content,
        embedding: embeddings[i],
      })),
    );
    if (error) {
      // supabase-js returns errors in-band; without this the write fails silently.
      console.error('[HeidiMemory] insert failed:', error.message);
    }
  } catch (error) {
    console.error('[HeidiMemory] storage failed:', error instanceof Error ? error.message : 'Unknown error');
  }
}
