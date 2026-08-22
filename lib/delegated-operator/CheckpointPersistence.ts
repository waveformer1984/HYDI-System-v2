/**
 * Supabase-backed persistence for goal checkpoints.
 *
 * Extends the in-memory GoalCheckpointManager with durable Supabase storage.
 * Checkpoints survive PM2 restart, process crash, and daemon restart.
 *
 * Secrets are redacted BEFORE insertion. No raw credential values,
 * API keys, tokens, or authentication cookies are ever written.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoalCheckpoint, GoalRuntimeStatus } from './GoalCheckpoint';
import { createHash } from 'crypto';

// Reuse the same redaction patterns as InterventionPersistence
const SECRET_PATTERNS = [
  /sk_live_[A-Za-z0-9]{10,}/g,
  /rk_live_[A-Za-z0-9]{10,}/g,
  /whsec_[A-Za-z0-9]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._-]{10,}/g,
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
  if (typeof value === 'number' || typeof typeof value === 'boolean') return value;
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
 * Compute a simple checksum for integrity verification.
 */
function computeChecksum(checkpoint: GoalCheckpoint): string {
  const data = JSON.stringify({
    goalId: checkpoint.goalId,
    planVersion: checkpoint.planVersion,
    completedObjectives: checkpoint.completedObjectives,
    executedActions: checkpoint.executedActions.map(a => a.actionId),
    executedSideEffects: checkpoint.executedSideEffects,
  });
  return createHash('sha256').update(data).digest('hex').substring(0, 16);
}

/**
 * Supabase-backed checkpoint persistence.
 */
export class CheckpointPersistence {
  private supabase: SupabaseClient | null;
  private enabled: boolean;

  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase ?? null;
    this.enabled = !!this.supabase;
  }

  /**
   * Persist a checkpoint to Supabase.
   * Returns true if persisted, false if Supabase is not configured or write failed.
   */
  async save(checkpoint: GoalCheckpoint): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;

    try {
      const redacted = redactDeep(checkpoint) as GoalCheckpoint;
      const checksum = computeChecksum(checkpoint);

      // Upsert — if a checkpoint with the same goal_id exists, update it
      const { error } = await this.supabase
        .from('goal_checkpoints')
        .upsert({
          checkpoint_id: redacted.checkpointId,
          goal_id: redacted.goalId,
          session_id: null, // session not directly in checkpoint
          identity_id: redacted.identityId,
          goal_statement: redacted.goalStatement,
          plan_version: redacted.planVersion,
          completed_objectives: redacted.completedObjectives,
          failed_objectives: redacted.failedObjectives,
          in_progress_objectives: redacted.inProgressObjectives,
          pending_objectives: redacted.pendingObjectives,
          executed_actions: redacted.executedActions,
          verified_state: redacted.verifiedState,
          status: redacted.status,
          resume_condition: redacted.resumeCondition,
          executed_side_effects: redacted.executedSideEffects,
          summary: redacted.summary,
          checksum,
        }, { onConflict: 'checkpoint_id' });

      if (error) {
        console.warn(
          `[CheckpointPersistence] Failed to save checkpoint:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
        return false;
      }
      return true;
    } catch (err) {
      console.warn(
        `[CheckpointPersistence] Exception saving checkpoint:`,
        err instanceof Error ? err.message : 'Unknown error',
      );
      return false;
    }
  }

  /**
   * Read the latest checkpoint for a goal.
   */
  async readByGoal(goalId: string): Promise<GoalCheckpoint | null> {
    if (!this.enabled || !this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from('goal_checkpoints')
        .select('*')
        .eq('goal_id', goalId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) return null;

      return this.rowToCheckpoint(data as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  /**
   * Read a specific checkpoint by ID.
   */
  async read(checkpointId: string): Promise<GoalCheckpoint | null> {
    if (!this.enabled || !this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from('goal_checkpoints')
        .select('*')
        .eq('checkpoint_id', checkpointId)
        .single();

      if (error || !data) return null;

      return this.rowToCheckpoint(data as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  /**
   * List all non-terminal checkpoints (for recovery after restart).
   */
  async listActive(): Promise<GoalCheckpoint[]> {
    if (!this.enabled || !this.supabase) return [];

    try {
      const { data, error } = await this.supabase
        .from('goal_checkpoints')
        .select('*')
        .in('status', ['RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN', 'WAITING_FOR_PROVIDER', 'RECOVERING'])
        .order('created_at', { ascending: false });

      if (error || !data) return [];

      return data.map((row) => this.rowToCheckpoint(row as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  /**
   * List ALL checkpoints including terminal ones.
   * Used during restart recovery to ensure terminal goals are known
   * so that stale interventions on terminal goals can be filtered out.
   */
  async listAll(): Promise<GoalCheckpoint[]> {
    if (!this.enabled || !this.supabase) return [];

    try {
      const { data, error } = await this.supabase
        .from('goal_checkpoints')
        .select('*')
        .order('created_at', { ascending: false });

      if (error || !data) return [];

      return data.map((row) => this.rowToCheckpoint(row as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  /**
   * Delete a checkpoint (after goal completion).
   */
  async delete(checkpointId: string): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;

    try {
      const { error } = await this.supabase
        .from('goal_checkpoints')
        .delete()
        .eq('checkpoint_id', checkpointId);

      return error === null;
    } catch {
      return false;
    }
  }

  /**
   * Verify checkpoint integrity using the stored checksum.
   */
  async verifyIntegrity(checkpointId: string): Promise<boolean> {
    if (!this.enabled || !this.supabase) return false;

    try {
      const { data, error } = await this.supabase
        .from('goal_checkpoints')
        .select('checksum, completed_objectives, executed_actions, executed_side_effects, plan_version, goal_id')
        .eq('checkpoint_id', checkpointId)
        .single();

      if (error || !data) return false;

      const storedChecksum = data.checksum as string;
      const computedChecksum = computeChecksum({
        checkpointId,
        goalId: data.goal_id as string,
        identityId: '',
        goalStatement: '',
        planVersion: data.plan_version as number,
        completedObjectives: data.completed_objectives as string[],
        failedObjectives: [],
        inProgressObjectives: [],
        pendingObjectives: [],
        executedActions: data.executed_actions as any[],
        verifiedState: {},
        status: 'RUNNING' as GoalRuntimeStatus,
        resumeCondition: '',
        executedSideEffects: data.executed_side_effects as string[],
        summary: '',
        createdAt: '',
      });

      return storedChecksum === computedChecksum;
    } catch {
      return false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private rowToCheckpoint(row: Record<string, unknown>): GoalCheckpoint {
    return {
      checkpointId: row.checkpoint_id as string,
      goalId: row.goal_id as string,
      identityId: row.identity_id as string,
      goalStatement: row.goal_statement as string,
      planVersion: row.plan_version as number,
      completedObjectives: row.completed_objectives as string[],
      failedObjectives: row.failed_objectives as string[],
      inProgressObjectives: row.in_progress_objectives as string[],
      pendingObjectives: row.pending_objectives as string[],
      executedActions: row.executed_actions as any[],
      verifiedState: row.verified_state as Record<string, unknown>,
      status: row.status as GoalRuntimeStatus,
      resumeCondition: row.resume_condition as string,
      executedSideEffects: row.executed_side_effects as string[],
      summary: row.summary as string,
      createdAt: row.created_at as string,
    };
  }
}
