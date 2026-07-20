/**
 * SESSION STATE LAYER (shared)
 *
 * Single owner of the `sessions` table, mirroring lib/heidi-memory.ts's
 * pattern for `memories`. Before this module existed, ModelManager,
 * lib/protoforge/dispatcher.ts, and the `update_database` action tool each
 * wrote to `sessions` independently with no shared notion of its schema.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionState } from '../types/index';
import structuredLogger from './structured-logger';

export type { SessionState };

const logger = structuredLogger.child({ component: 'SessionState' });

/**
 * Upsert fields onto a session row. `updated_at` is always stamped with the
 * current time regardless of what the caller passes.
 */
export async function updateSessionState(
  supabase: SupabaseClient,
  sessionId: string,
  fields: Partial<Omit<SessionState, 'session_id'>> | Record<string, unknown>,
): Promise<{ error?: string }> {
  try {
    const { error } = await supabase.from('sessions').upsert({
      ...fields,
      session_id: sessionId,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      logger.error('update failed', { error: error.message });
      return { error: error.message };
    }
    return {};
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('update failed', { error: message });
    return { error: message };
  }
}

export async function getSessionState(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<SessionState | null> {
  try {
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();
    return data;
  } catch (error) {
    logger.error('get failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    return null;
  }
}
