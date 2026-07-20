/**
 * RAW EVENT LEDGER — pipeline layer [2] (see HEIDI_V2_ARCHITECTURE.md)
 *
 * Append-only, immutable, hashed single source of truth, backed by the real
 * `raw_event_ledger` Supabase table
 * (supabase/migrations/20260714120000_raw_event_ledger_table.sql) — unlike
 * modules/raw-event-ledger-v2.js's in-memory prototype, which this
 * supersedes. Only two operations exist on purpose: append and read.
 * Nothing here updates or deletes a row; the database schema itself denies
 * that (no UPDATE/DELETE RLS policy exists for any role).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import structuredLogger from '../structured-logger';

const logger = structuredLogger.child({ component: 'RawLedger' });

export interface RawEvent {
  fingerprint: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export interface RawEventRecord extends RawEvent {
  id: string;
  hash: string;
  created_at: string;
}

function computeHash(event: RawEvent): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ fingerprint: event.fingerprint, event_type: event.event_type, payload: event.payload }))
    .digest('hex');
}

/**
 * Append an event to the ledger. Idempotent on `fingerprint` — appending
 * the same fingerprint twice fails on the table's unique constraint rather
 * than silently duplicating it.
 */
export async function appendEvent(
  supabase: SupabaseClient,
  event: RawEvent,
): Promise<{ record?: RawEventRecord; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('raw_event_ledger')
      .insert({
        fingerprint: event.fingerprint,
        event_type: event.event_type,
        payload: event.payload,
        hash: computeHash(event),
      })
      .select()
      .single();

    if (error) {
      logger.error('append failed', { error: error.message });
      return { error: error.message };
    }
    return { record: data as RawEventRecord };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('append failed', { error: message });
    return { error: message };
  }
}

export async function getEventByFingerprint(
  supabase: SupabaseClient,
  fingerprint: string,
): Promise<RawEventRecord | null> {
  try {
    const { data } = await supabase
      .from('raw_event_ledger')
      .select('*')
      .eq('fingerprint', fingerprint)
      .maybeSingle();
    return (data as RawEventRecord) ?? null;
  } catch (error) {
    logger.error('read failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    return null;
  }
}
