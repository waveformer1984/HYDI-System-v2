/**
 * EPISODIC MEMORY (shared)
 *
 * Extends the `memories` table (lib/heidi-memory.ts) with a `kind`
 * discriminator instead of adding a new table. Rather than saving every
 * interaction, this saves distilled experiences — problem, actions taken,
 * outcome, lesson — so the system accumulates experience over time instead
 * of just raw conversation history. See
 * supabase/migrations/20260714130000_memories_episodic_kind.sql.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding } from './embeddings';
import structuredLogger from './structured-logger';

const logger = structuredLogger.child({ component: 'EpisodicMemory' });

export interface ActionOutcome {
  type: string;
  status: string;
  error?: string;
}

export interface Experience {
  problem: string;
  actionsTaken: ActionOutcome[];
  outcome: 'success' | 'partial_failure' | 'failure';
  lesson: string;
}

function deriveOutcome(results: ActionOutcome[]): Experience['outcome'] {
  if (results.every((r) => r.status === 'completed')) return 'success';
  if (results.every((r) => r.status === 'failed')) return 'failure';
  return 'partial_failure';
}

function deriveLesson(results: ActionOutcome[]): string {
  const failures = results.filter((r) => r.status === 'failed');
  if (failures.length === 0) return 'All proposed actions completed successfully.';
  return failures.map((f) => `${f.type} failed${f.error ? `: ${f.error}` : ''}`).join('; ');
}

/** Distill a turn's action results into an Experience — pure, no I/O. */
export function buildExperience(problem: string, results: ActionOutcome[]): Experience {
  return {
    problem,
    actionsTaken: results,
    outcome: deriveOutcome(results),
    lesson: deriveLesson(results),
  };
}

/**
 * Persist an experience as a `memories` row with kind='episodic'. Degrades
 * gracefully like lib/heidi-memory.ts — never throws, logs and returns on
 * failure so a storage hiccup can't fail chat processing.
 */
export async function storeExperience(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  experience: Experience,
): Promise<void> {
  try {
    const content = [
      `Experience: ${experience.problem}`,
      `Actions: ${experience.actionsTaken.map((a) => `${a.type}=${a.status}`).join(', ') || 'none'}`,
      `Outcome: ${experience.outcome}`,
      `Lesson: ${experience.lesson}`,
    ].join('\n');

    const embedding = await generateEmbedding(content);

    const { error } = await supabase.from('memories').insert({
      user_id: userId,
      session_id: sessionId,
      content,
      embedding,
      kind: 'episodic',
      metadata: {
        problem: experience.problem,
        actions_taken: experience.actionsTaken,
        outcome: experience.outcome,
        lesson: experience.lesson,
      },
    });

    if (error) {
      logger.error('insert failed', { error: error.message });
    }
  } catch (error) {
    logger.error('storage failed', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
