/**
 * Supabase-backed persistence for human intervention requests.
 *
 * Extends the in-memory InterventionQueue with durable Supabase storage.
 * Interventions survive PM2 restart, process crash, and daemon restart.
 *
 * Secrets are redacted BEFORE insertion. No raw credential values,
 * API keys, tokens, or authentication cookies are ever written.
 * Only references and metadata are persisted.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PersistentInterventionRequest } from './InterventionQueue';

// Secret redaction — same patterns as SupabasePersistence
const SECRET_PATTERNS = [
  /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /sk_live_[A-Za-z0-9]{10,}/g,
  /rk_live_[A-Za-z0-9]{10,}/g,
  /whsec_[A-Za-z0-9]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._-]{10,}/g,
  // Inline key=value patterns for secrets embedded in strings
  /password\s*=\s*[^\s,;}\]]+/gi,
  /secret\s*=\s*[^\s,;}\]]+/gi,
  /token\s*=\s*[^\s,;}\]]+/gi,
  /api[_-]?key\s*=\s*[^\s,;}\]]+/gi,
  /session[_-]?cookie\s*=\s*[^\s,;}\]]+/gi,
  /cookie\s*=\s*[^\s,;}\]]+/gi,
  /mfa[_-]?secret\s*=\s*[^\s,;}\]]+/gi,
  /session[_-]?secret\s*=\s*[^\s,;}\]]+/gi,
  /otp\s*=\s*[^\s,;}\]]+/gi,
  /authorization\s*=\s*[^\s,;}\]]+/gi,
];

const SENSITIVE_KEY_RE = /(password|secret|token|api[_-]?key|authorization|service_role|private_key|credential|cookie|session_secret|mfa_secret|otp)/i;
const REDACTED = '[REDACTED]';

function redactString(value: string): string {
  let out = value;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === 'string') return redactString(value);
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactDeep(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/**
 * Supabase-backed intervention persistence.
 */
export class InterventionPersistence {
  private supabase: SupabaseClient | null;
  private enabled: boolean;

  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase ?? null;
    this.enabled = !!this.supabase;
  }

  /**
   * Persist a new intervention request to Supabase.
   * Returns true if persisted, false if Supabase is not configured or write failed.
   */
  async create(request: PersistentInterventionRequest): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;

    try {
      // Redact the entire request before persisting
      const redacted = redactDeep(request) as PersistentInterventionRequest;

      const { error } = await this.supabase
        .from('human_intervention_requests')
        .insert({
          request_id: redacted.requestId,
          goal_id: redacted.goalId,
          session_id: redacted.userId, // session_id not directly in request; use userId field for session
          user_id: redacted.userId,
          identity_id: redacted.identityId,
          objective: redacted.currentObjective,
          blocker: redacted.blocker,
          required_action: redacted.requiredHumanAction,
          why_required: redacted.whyRequired,
          expected_state: redacted.expectedResultingState,
          resume_condition: redacted.resumeCondition,
          intervention_type: redacted.interventionType,
          audit_id: redacted.auditId,
          status: redacted.status,
          created_at: redacted.requestedAt,
          expires_at: redacted.expiresAt,
        });

      if (error) {
        console.warn(
          `[InterventionPersistence] Failed to create intervention:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
        return false;
      }
      return true;
    } catch (err) {
      console.warn(
        `[InterventionPersistence] Exception creating intervention:`,
        err instanceof Error ? err.message : 'Unknown error',
      );
      return false;
    }
  }

  /**
   * Read a single intervention by request_id.
   */
  async read(requestId: string): Promise<PersistentInterventionRequest | null> {
    if (!this.enabled || !this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from('human_intervention_requests')
        .select('*')
        .eq('request_id', requestId)
        .single();

      if (error || !data) return null;

      return this.rowToRequest(data as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  /**
   * List all pending interventions.
   */
  async listPending(): Promise<PersistentInterventionRequest[]> {
    if (!this.enabled || !this.supabase) return [];

    try {
      const { data, error } = await this.supabase
        .from('human_intervention_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error || !data) return [];

      return data.map((row) => this.rowToRequest(row as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  /**
   * List all interventions for a goal.
   */
  async listByGoal(goalId: string): Promise<PersistentInterventionRequest[]> {
    if (!this.enabled || !this.supabase) return [];

    try {
      const { data, error } = await this.supabase
        .from('human_intervention_requests')
        .select('*')
        .eq('goal_id', goalId)
        .order('created_at', { ascending: true });

      if (error || !data) return [];

      return data.map((row) => this.rowToRequest(row as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  /**
   * Acknowledge (mark as seen/processing) — does not change status.
   * Returns true if the intervention exists and is pending.
   */
  async acknowledge(requestId: string): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;

    try {
      const { data, error } = await this.supabase
        .from('human_intervention_requests')
        .select('status')
        .eq('request_id', requestId)
        .single();

      if (error || !data) return false;
      return (data as Record<string, unknown>).status === 'pending';
    } catch {
      return false;
    }
  }

  /**
   * Mark an intervention as resolved.
   */
  async complete(requestId: string, resolutionNote: string): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;

    try {
      const redactedNote = redactString(resolutionNote);
      const { error } = await this.supabase
        .from('human_intervention_requests')
        .update({
          status: 'resolved',
          resolution_note: redactedNote,
          completed_at: new Date().toISOString(),
        })
        .eq('request_id', requestId)
        .eq('status', 'pending'); // Only pending can be resolved

      if (error) {
        console.warn(
          `[InterventionPersistence] Failed to complete intervention:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
        return false;
      }
      return true;
    } catch (err) {
      console.warn(
        `[InterventionPersistence] Exception completing intervention:`,
        err instanceof Error ? err.message : 'Unknown error',
      );
      return false;
    }
  }

  /**
   * Mark an intervention as cancelled.
   */
  async cancel(requestId: string): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;

    try {
      const { error } = await this.supabase
        .from('human_intervention_requests')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
        })
        .eq('request_id', requestId)
        .eq('status', 'pending');

      if (error) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Expire all interventions that have passed their expiry time.
   */
  async expireStale(): Promise<number> {
    if (!this.enabled || !this.supabase) return 0;

    try {
      const { data, error } = await this.supabase
        .from('human_intervention_requests')
        .update({
          status: 'expired',
          completed_at: new Date().toISOString(),
        })
        .eq('status', 'pending')
        .lt('expires_at', new Date().toISOString())
        .select('id');

      if (error) return 0;
      return data?.length ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check if persistence is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Convert a database row to a PersistentInterventionRequest.
   * Note: the originalRequest field is not persisted to Supabase
   * (it may contain sensitive context). Only metadata is persisted.
   */
  private rowToRequest(row: Record<string, unknown>): PersistentInterventionRequest {
    return {
      requestId: row.request_id as string,
      goalId: row.goal_id as string,
      identityId: row.identity_id as string,
      userId: row.user_id as string,
      currentObjective: row.objective as string,
      blocker: row.blocker as string,
      requiredHumanAction: row.required_action as string,
      whyRequired: row.why_required as string,
      expectedResultingState: row.expected_state as string,
      requestedAt: row.created_at as string,
      expiresAt: row.expires_at as string,
      resumeCondition: row.resume_condition as string,
      auditId: row.audit_id as string,
      interventionType: row.intervention_type as string,
      status: row.status as 'pending' | 'resolved' | 'expired' | 'cancelled',
      resolvedAt: row.completed_at as string | undefined,
      resolutionNote: row.resolution_note as string | undefined,
      // originalRequest is not persisted — reconstruct a minimal version
      originalRequest: {
        requestId: row.request_id as string,
        actionId: 'persisted',
        goalId: row.goal_id as string,
        reason: row.blocker as string,
        whatWasAttempted: row.objective as string,
        whatSucceeded: '',
        whatFailed: row.blocker as string,
        whyCannotContinue: row.why_required as string,
        requiredHumanAction: row.required_action as string,
        whatHappensAfter: row.expected_state as string,
        interventionType: (row.intervention_type as string) as any,
        timestamp: row.created_at as string,
      },
    };
  }
}
