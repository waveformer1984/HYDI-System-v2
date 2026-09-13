/**
 * Supabase-backed persistence for AdaptiveOperator events.
 *
 * The AdaptiveOperator generates events during goal execution:
 *   - observations (environment scans)
 *   - actions (HumanActionEngine executions)
 *   - replans (deviation-triggered plan changes)
 *   - deviations (expected-vs-actual comparisons)
 *   - failures (classified failure records)
 *   - completions (goal completion results)
 *   - interventions (human intervention requests)
 *   - decisions (retry/replan/escalate decisions)
 *   - budget_exhausted (autonomy limit reached)
 *   - escalation (goal escalated to human)
 *
 * This module writes those events to the `adaptive_operator_events`
 * Supabase table, providing durability that survives cold starts,
 * process restarts, and fresh clones. Local-disk persistence
 * (ActionJournal, TaskMemoryStore) still works alongside this —
 * defense in depth.
 *
 * Secrets are redacted BEFORE insertion by:
 *   1. ActionJournal's redactParameters() — redacts action parameters
 *   2. structured-logger's redactValue() — redacts secret-shaped values
 *   3. This module's redactPayload() — final safety net
 *
 * No raw credential values, API keys, or tokens are ever written.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AdaptiveEventType =
  | 'observation'
  | 'action'
  | 'replan'
  | 'deviation'
  | 'failure'
  | 'completion'
  | 'intervention'
  | 'decision'
  | 'goal_received'
  | 'budget_exhausted'
  | 'escalation';

export interface AdaptiveEvent {
  goalId: string;
  sessionId?: string;
  userId?: string;
  eventType: AdaptiveEventType;
  payload: Record<string, unknown>;
}

// Secret-shaped patterns to redact in payload values — matches
// structured-logger's SECRET_VALUE_PATTERNS.
const SECRET_PATTERNS = [
  /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /sk_live_[A-Za-z0-9]{10,}/g,
  /rk_live_[A-Za-z0-9]{10,}/g,
  /whsec_[A-Za-z0-9]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._-]{10,}/g,
];

const SENSITIVE_KEY_RE = /(password|secret|token|api[_-]?key|authorization|service_role|private_key|credential)/i;
const REDACTED = '[REDACTED]';

function redactString(value: string): string {
  let out = value;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === 'string') return redactString(value);
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redactPayload(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactPayload(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export class SupabasePersistence {
  private supabase: SupabaseClient | null;
  private enabled: boolean;

  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase ?? null;
    this.enabled = !!this.supabase;
  }

  /**
   * Write a single event to the adaptive_operator_events table.
   * Returns true if persisted, false if Supabase is not configured
   * or the write failed (non-fatal — local disk is the fallback).
   */
  async writeEvent(event: AdaptiveEvent): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;

    try {
      const redactedPayload = redactPayload(event.payload);
      const { error } = await this.supabase
        .from('adaptive_operator_events')
        .insert({
          goal_id: event.goalId,
          session_id: event.sessionId ?? null,
          user_id: event.userId ?? null,
          event_type: event.eventType,
          payload: redactedPayload,
        });

      if (error) {
        // Non-fatal — local disk persistence still works.
        // Log to console (structured-logger may not be available here).
        console.warn(
          `[AdaptiveOperator:persist] Failed to write ${event.eventType} event:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
        return false;
      }
      return true;
    } catch (err) {
      console.warn(
        `[AdaptiveOperator:persist] Exception writing ${event.eventType} event:`,
        err instanceof Error ? err.message : 'Unknown error',
      );
      return false;
    }
  }

  /**
   * Write multiple events in a single batch insert.
   */
  async writeEvents(events: AdaptiveEvent[]): Promise<boolean> {
    if (!this.enabled || !this.supabase || events.length === 0) return false;

    try {
      const rows = events.map((e) => ({
        goal_id: e.goalId,
        session_id: e.sessionId ?? null,
        user_id: e.userId ?? null,
        event_type: e.eventType,
        payload: redactPayload(e.payload),
      }));

      const { error } = await this.supabase
        .from('adaptive_operator_events')
        .insert(rows);

      if (error) {
        console.warn(
          `[AdaptiveOperator:persist] Batch write failed:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
        return false;
      }
      return true;
    } catch (err) {
      console.warn(
        `[AdaptiveOperator:persist] Batch write exception:`,
        err instanceof Error ? err.message : 'Unknown error',
      );
      return false;
    }
  }

  /**
   * Read all events for a goal, ordered by creation time.
   * Used to reconstruct goal history after a cold start.
   */
  async readEvents(goalId: string): Promise<AdaptiveEvent[]> {
    if (!this.enabled || !this.supabase) return [];

    try {
      const { data, error } = await this.supabase
        .from('adaptive_operator_events')
        .select('*')
        .eq('goal_id', goalId)
        .order('created_at', { ascending: true });

      if (error || !data) return [];

      return data.map((row: Record<string, unknown>) => ({
        goalId: row.goal_id as string,
        sessionId: row.session_id as string | undefined,
        userId: row.user_id as string | undefined,
        eventType: row.event_type as AdaptiveEventType,
        payload: row.payload as Record<string, unknown>,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Check if Supabase persistence is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
