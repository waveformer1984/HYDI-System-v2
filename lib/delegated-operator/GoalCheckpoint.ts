/**
 * HYDI Goal Checkpoint Manager
 *
 * Enables goal resumption from a safe checkpoint after restart.
 *
 * After restart:
 *   LOAD GOAL
 *   → LOAD LAST VERIFIED STATE
 *   → REVALIDATE CURRENT ENVIRONMENT
 *   → RESUME FROM SAFE CHECKPOINT
 *
 * Never blindly replay previously executed side effects.
 */

import { randomUUID } from 'crypto';
import type { CheckpointPersistence } from './CheckpointPersistence';

// ---------------------------------------------------------------------------
// Goal Runtime Status
// ---------------------------------------------------------------------------

/**
 * Extended goal status for the delegated operator.
 * Includes states beyond the original AdaptiveOperator GoalStatus.
 */
export type GoalRuntimeStatus =
  | 'PAUSED'               // explicitly paused by user
  | 'WAITING_FOR_HUMAN'    // intervention requested
  | 'WAITING_FOR_PROVIDER' // provider unavailable, will retry
  | 'RECOVERING'           // recovering from a failure
  | 'RUNNING'              // actively executing
  | 'COMPLETED'            // all objectives verified
  | 'PARTIAL'              // some objectives complete, some failed
  | 'FAILED'               // goal cannot be completed
  | 'EXPIRED';             // delegation expired

// ---------------------------------------------------------------------------
// Goal Checkpoint
// ---------------------------------------------------------------------------

/**
 * A checkpoint captures the verified state of a goal at a point where
 * it is safe to resume after a restart.
 */
export interface GoalCheckpoint {
  /** Unique checkpoint ID */
  checkpointId: string;
  /** The goal ID */
  goalId: string;
  /** The identity that owns this goal */
  identityId: string;
  /** The goal statement */
  goalStatement: string;
  /** The current plan version */
  planVersion: number;
  /** Objectives that have been verified complete */
  completedObjectives: string[];
  /** Objectives that have failed */
  failedObjectives: string[];
  /** Objectives that are in progress */
  inProgressObjectives: string[];
  /** Objectives that are pending */
  pendingObjectives: string[];
  /** Actions that have been executed (with results) */
  executedActions: CheckpointAction[];
  /** The last verified world state snapshot (key observations only) */
  verifiedState: Record<string, unknown>;
  /** The runtime status at checkpoint time */
  status: GoalRuntimeStatus;
  /** When the checkpoint was created */
  createdAt: string;
  /** The resume condition (what must be true to resume) */
  resumeCondition: string;
  /** Side effects that have already been executed (to avoid replay) */
  executedSideEffects: string[];
  /** Human-readable summary */
  summary: string;
}

/**
 * An action recorded in a checkpoint.
 */
export interface CheckpointAction {
  actionId: string;
  capability: string;
  target: string;
  outcome: string;
  verified: boolean;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Goal Checkpoint Manager
// ---------------------------------------------------------------------------

/**
 * Manages goal checkpoints for resumption after restart.
 *
 * Checkpoints are stored in-memory and optionally persisted to Supabase.
 * On restart, the manager loads checkpoints and revalidates the
 * environment before resuming.
 */
export class GoalCheckpointManager {
  private checkpoints = new Map<string, GoalCheckpoint>();
  private goalToCheckpoint = new Map<string, string>();
  private persistence: CheckpointPersistence | null = null;

  /**
   * Attach Supabase persistence. After attaching, all checkpoint operations
   * are also written to Supabase, surviving restart.
   */
  attachPersistence(persistence: CheckpointPersistence): void {
    this.persistence = persistence;
  }

  /**
   * Create a checkpoint for a goal.
   * Also persists to Supabase if persistence is attached.
   */
  checkpoint(input: Omit<GoalCheckpoint, 'checkpointId' | 'createdAt'>): GoalCheckpoint {
    const checkpointId = `ckpt_${randomUUID()}`;
    const createdAt = new Date().toISOString();

    const checkpoint: GoalCheckpoint = {
      ...input,
      checkpointId,
      createdAt,
    };

    this.checkpoints.set(checkpointId, checkpoint);
    this.goalToCheckpoint.set(input.goalId, checkpointId);

    // Persist to Supabase (fire-and-forget — non-fatal if it fails)
    if (this.persistence) {
      this.persistence.save(checkpoint).catch(() => { /* non-fatal */ });
    }

    return checkpoint;
  }

  /**
   * Get the latest checkpoint for a goal.
   */
  getCheckpoint(goalId: string): GoalCheckpoint | null {
    const checkpointId = this.goalToCheckpoint.get(goalId);
    if (!checkpointId) return null;
    return this.checkpoints.get(checkpointId) ?? null;
  }

  /**
   * Get all checkpoints.
   */
  getAllCheckpoints(): GoalCheckpoint[] {
    return Array.from(this.checkpoints.values());
  }

  /**
   * Revalidate the environment after a restart.
   *
   * This does NOT replay side effects. It checks whether the
   * verified state in the checkpoint is still consistent with
   * the current environment.
   *
   * Returns the objectives that need to be re-executed.
   */
  revalidate(checkpoint: GoalCheckpoint, currentObservations: Map<string, unknown>): {
    consistent: boolean;
    invalidatedObjectives: string[];
    reason: string;
  } {
    const invalidated: string[] = [];

    // Check each verified state entry against current observations
    for (const [key, expectedValue] of Object.entries(checkpoint.verifiedState)) {
      const currentValue = currentObservations.get(key);
      if (currentValue === undefined) {
        // Observation is gone — may need to re-observe
        continue;
      }
      if (JSON.stringify(currentValue) !== JSON.stringify(expectedValue)) {
        // State has changed — the objective that produced this state
        // may need to be re-verified
        invalidated.push(key);
      }
    }

    return {
      consistent: invalidated.length === 0,
      invalidatedObjectives: invalidated,
      reason: invalidated.length === 0
        ? 'All verified state consistent with current environment'
        : `State changed: ${invalidated.join(', ')}`,
    };
  }

  /**
   * Determine the resume point from a checkpoint.
   *
   * Never replays completed objectives. Only resumes from:
   *   - in-progress objectives (re-verified)
   *   - pending objectives
   */
  getResumePoint(checkpoint: GoalCheckpoint): {
    resumeFrom: 'beginning' | 'in_progress' | 'pending' | 'completed';
    objectivesToExecute: string[];
    objectivesToSkip: string[];
    reason: string;
  } {
    if (checkpoint.completedObjectives.length > 0 && checkpoint.pendingObjectives.length === 0 && checkpoint.inProgressObjectives.length === 0) {
      return {
        resumeFrom: 'completed',
        objectivesToExecute: [],
        objectivesToSkip: checkpoint.completedObjectives,
        reason: 'All objectives were completed before checkpoint',
      };
    }

    if (checkpoint.inProgressObjectives.length > 0) {
      return {
        resumeFrom: 'in_progress',
        objectivesToExecute: [...checkpoint.inProgressObjectives, ...checkpoint.pendingObjectives],
        objectivesToSkip: checkpoint.completedObjectives,
        reason: `Resuming from in-progress: ${checkpoint.inProgressObjectives.join(', ')}`,
      };
    }

    if (checkpoint.pendingObjectives.length > 0) {
      return {
        resumeFrom: 'pending',
        objectivesToExecute: checkpoint.pendingObjectives,
        objectivesToSkip: checkpoint.completedObjectives,
        reason: `Resuming from pending: ${checkpoint.pendingObjectives.join(', ')}`,
      };
    }

    return {
      resumeFrom: 'beginning',
      objectivesToExecute: [],
      objectivesToSkip: [],
      reason: 'No objectives to resume',
    };
  }

  /**
   * Serialize all checkpoints for persistence.
   */
  serialize(): GoalCheckpoint[] {
    return Array.from(this.checkpoints.values());
  }

  /**
   * Restore checkpoints from persistence.
   */
  restore(checkpoints: GoalCheckpoint[]): void {
    this.checkpoints.clear();
    this.goalToCheckpoint.clear();
    for (const cp of checkpoints) {
      this.checkpoints.set(cp.checkpointId, cp);
      this.goalToCheckpoint.set(cp.goalId, cp.checkpointId);
    }
  }

  /**
   * Remove a checkpoint (e.g. after goal completion).
   */
  remove(goalId: string): boolean {
    const checkpointId = this.goalToCheckpoint.get(goalId);
    if (!checkpointId) return false;
    this.goalToCheckpoint.delete(goalId);
    return this.checkpoints.delete(checkpointId);
  }

  /**
   * Restore active checkpoints from Supabase persistence.
   * Called on daemon startup to recover checkpoints that survived restart.
   * Only non-terminal checkpoints are restored.
   */
  async restoreFromPersistence(): Promise<number> {
    if (!this.persistence) return 0;

    try {
      const active = await this.persistence.listActive();

      for (const cp of active) {
        // Don't overwrite in-memory checkpoints that may have been added
        // during this session before restore was called
        if (!this.checkpoints.has(cp.checkpointId)) {
          this.checkpoints.set(cp.checkpointId, cp);
          this.goalToCheckpoint.set(cp.goalId, cp.checkpointId);
        }
      }

      return active.length;
    } catch {
      return 0;
    }
  }
}
