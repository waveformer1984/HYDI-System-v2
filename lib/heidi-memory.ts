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

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

const USER_PREFIX = 'User: ';
const ASSISTANT_PREFIX = 'Assistant: ';

/**
 * Number of recent message rows (not turns) to pull back into the prompt for
 * short-term conversational coherence. One turn is two rows (user + assistant).
 */
export function getHistoryLimit(): number {
  const raw = Number(process.env.HEIDI_HISTORY_TURNS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 6;
}

/**
 * Fetch the most recent messages for a single session, oldest-first, so the
 * model can follow the current conversation without restating context.
 *
 * Session-scoped (not user-scoped) so a fresh page load / new session starts
 * clean. Degrades to [] on any error. Role is recovered from the stored prefix
 * written by storeMemory (single source of truth in this module).
 */
export async function getRecentHistory(
  supabase: SupabaseClient,
  sessionId: string,
  limit: number = getHistoryLimit(),
): Promise<ConversationTurn[]> {
  try {
    const { data } = await supabase
      .from('memories')
      .select('content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!data || data.length === 0) return [];

    return (data as Array<{ content: string }>)
      .slice()
      .reverse()
      .map((row) => {
        if (row.content.startsWith(USER_PREFIX)) {
          return { role: 'user' as const, content: row.content.slice(USER_PREFIX.length) };
        }
        if (row.content.startsWith(ASSISTANT_PREFIX)) {
          return { role: 'assistant' as const, content: row.content.slice(ASSISTANT_PREFIX.length) };
        }
        return { role: 'user' as const, content: row.content };
      });
  } catch (error) {
    console.error('[HeidiMemory] history retrieval failed:', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

/**
 * Render recent turns as a compact, labelled transcript for prompt injection.
 * Returns '' when there is no history so callers can omit the section entirely.
 */
export function formatHistory(history: ConversationTurn[]): string {
  if (history.length === 0) return '';
  const lines = history.map((turn) => `${turn.role === 'user' ? 'User' : 'Heidi'}: ${turn.content}`);
  return `Recent conversation:\n${lines.join('\n')}`;
}

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

    await supabase.from('memories').insert([
      { user_id: userId, session_id: sessionId, content: `User: ${userMessage}`, embedding: userEmbedding },
      { user_id: userId, session_id: sessionId, content: `Assistant: ${assistantResponse}`, embedding: assistantEmbedding },
    ]);
  } catch (error) {
    console.error('[HeidiMemory] storage failed:', error instanceof Error ? error.message : 'Unknown error');
  }
}
