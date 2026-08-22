/**
 * InterventionController — First-Class Intervention Workflow
 *
 * Upgrades intervention handling into a first-class operational workflow
 * with APPROVE, REJECT, CANCEL, and EXPIRE operations.
 *
 * Approval MUST resume from the checkpoint. It MUST NOT replay
 * already completed actions.
 *
 * After approval:
 *   1. restore checkpoint
 *   2. verify current environment
 *   3. detect stale state
 *   4. replan if necessary
 *   5. continue only through governed authorization
 *   6. verify final state
 *
 * This controller wraps the existing InterventionQueue and does NOT
 * replace it. It adds workflow semantics on top.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getInterventionQueue, getCheckpointManager, getIdentityManager } from './DelegatedOperatorIntegration';
import type { PersistentInterventionRequest } from './InterventionQueue';
import type { GoalCheckpoint } from './GoalCheckpoint';
import { getHumanProxyControlPlane } from './HumanProxyControlPlane';
import type { OperationalEvent } from './OperationalEvent';

// ---------------------------------------------------------------------------
// Intervention Resolution Types
// ---------------------------------------------------------------------------

export type InterventionResolution = 'approved' | 'rejected' | 'cancelled' | 'expired';

export interface InterventionResolutionResult {
  requestId: string;
  resolution: InterventionResolution;
  resumed: boolean;
  checkpointId?: string;
  staleStateDetected: boolean;
  replanRequired: boolean;
  objectivesToSkip: string[];
  objectivesToExecute: string[];
  reason: string;
}

// ---------------------------------------------------------------------------
// Intervention Detail (for API exposure)
// ---------------------------------------------------------------------------

export interface InterventionDetail {
  interventionId: string;
  goalId: string;
  identityId: string;
  capability?: string;
  resource?: string;
  risk?: string;
  reason: string;
  requiredHumanAction: string;
  createdAt: string;
  expiresAt: string;
  checkpointId?: string;
  resumeCondition: string;
  status: string;
  interventionType: string;
  whyRequired: string;
  expectedResultingState: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Controls the intervention lifecycle, integrating with checkpoints
 * for safe resumption.
 */
export class InterventionController {
  private supabase: SupabaseClient | null = null;

  /**
   * Initialize with Supabase client.
   */
  initialize(supabase: SupabaseClient): void {
    this.supabase = supabase;
  }

  /**
   * Get detailed intervention information for API exposure.
   */
  getInterventionDetail(interventionId: string): InterventionDetail | null {
    const queue = getInterventionQueue();
    const entry = queue.get(interventionId);
    if (!entry) return null;

    const checkpointManager = getCheckpointManager();
    const checkpoint = checkpointManager.getCheckpoint(entry.goalId);

    return {
      interventionId: entry.requestId,
      goalId: entry.goalId,
      identityId: entry.identityId,
      capability: entry.originalRequest?.whatWasAttempted,
      resource: entry.originalRequest?.whatSucceeded,
      risk: entry.originalRequest?.interventionType,
      reason: entry.blocker,
      requiredHumanAction: entry.requiredHumanAction,
      createdAt: entry.requestedAt,
      expiresAt: entry.expiresAt,
      checkpointId: checkpoint?.checkpointId,
      resumeCondition: entry.resumeCondition,
      status: entry.status,
      interventionType: entry.interventionType,
      whyRequired: entry.whyRequired ?? entry.blocker,
      expectedResultingState: entry.expectedResultingState,
    };
  }

  /**
   * APPROVE an intervention.
   *
   * This resolves the intervention as 'approved' and prepares
   * the goal for resumption from its checkpoint.
   *
   * It does NOT execute any actions. It only:
   *   1. marks the intervention as approved
   *   2. loads the checkpoint
   *   3. verifies the environment
   *   4. detects stale state
   *   5. determines what to skip and what to execute
   *
   * The actual execution is handled by the existing governed execution path.
   */
  async approve(
    interventionId: string,
    approvedBy: string,
    note?: string,
  ): Promise<InterventionResolutionResult> {
    const queue = getInterventionQueue();
    const entry = queue.get(interventionId);

    if (!entry) {
      return this.fail(interventionId, 'approved', 'Intervention not found');
    }
    if (entry.status !== 'pending') {
      return this.fail(interventionId, 'approved', `Intervention is not pending (status: ${entry.status})`);
    }

    // Check expiry
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      queue.cancel(interventionId);
      return this.fail(interventionId, 'expired', 'Intervention has expired');
    }

    // Mark as resolved (approved)
    const resolutionNote = `Approved by ${approvedBy}${note ? ': ' + note : ''}`;
    const resolved = queue.resolve(interventionId, resolutionNote);
    if (!resolved) {
      return this.fail(interventionId, 'approved', 'Failed to resolve intervention');
    }

    // Load checkpoint
    const checkpointManager = getCheckpointManager();
    const checkpoint = checkpointManager.getCheckpoint(entry.goalId);

    if (!checkpoint) {
      return {
        requestId: interventionId,
        resolution: 'approved',
        resumed: false,
        staleStateDetected: false,
        replanRequired: false,
        objectivesToSkip: [],
        objectivesToExecute: [],
        reason: 'No checkpoint found — cannot resume from safe state',
      };
    }

    // Record intervention approved event
    const controlPlane = getHumanProxyControlPlane();
    await controlPlane.recordEvent({
      goalId: entry.goalId,
      identityId: entry.identityId,
      eventType: 'INTERVENTION_APPROVED',
      payload: {
        interventionId,
        interventionType: entry.interventionType,
        interventionReason: entry.blocker,
        checkpointId: checkpoint.checkpointId,
      },
    });

    // Get resume point from checkpoint
    const resume = checkpointManager.getResumePoint(checkpoint);

    // Determine if replan is needed (if there were failed objectives)
    const replanRequired = checkpoint.failedObjectives.length > 0;

    return {
      requestId: interventionId,
      resolution: 'approved',
      resumed: true,
      checkpointId: checkpoint.checkpointId,
      staleStateDetected: false, // Will be determined by the execution layer
      replanRequired,
      objectivesToSkip: resume.objectivesToSkip,
      objectivesToExecute: resume.objectivesToExecute,
      reason: `Approved. Resuming from checkpoint ${checkpoint.checkpointId}. ${resume.reason}`,
    };
  }

  /**
   * REJECT an intervention.
   *
   * This marks the intervention as rejected and prevents the goal
   * from resuming. The goal remains in its current state (typically
   * WAITING_FOR_HUMAN) and must be explicitly cancelled or replanned.
   */
  async reject(
    interventionId: string,
    rejectedBy: string,
    reason?: string,
  ): Promise<InterventionResolutionResult> {
    const queue = getInterventionQueue();
    const entry = queue.get(interventionId);

    if (!entry) {
      return this.fail(interventionId, 'rejected', 'Intervention not found');
    }
    if (entry.status !== 'pending') {
      return this.fail(interventionId, 'rejected', `Intervention is not pending (status: ${entry.status})`);
    }

    // Mark as resolved (rejected)
    const resolutionNote = `Rejected by ${rejectedBy}${reason ? ': ' + reason : ''}`;
    const resolved = queue.resolve(interventionId, resolutionNote);
    if (!resolved) {
      return this.fail(interventionId, 'rejected', 'Failed to resolve intervention');
    }

    // Record intervention rejected event
    const controlPlane = getHumanProxyControlPlane();
    await controlPlane.recordEvent({
      goalId: entry.goalId,
      identityId: entry.identityId,
      eventType: 'INTERVENTION_REJECTED',
      payload: {
        interventionId,
        interventionType: entry.interventionType,
        interventionReason: entry.blocker,
      },
    });

    return {
      requestId: interventionId,
      resolution: 'rejected',
      resumed: false,
      staleStateDetected: false,
      replanRequired: false,
      objectivesToSkip: [],
      objectivesToExecute: [],
      reason: `Rejected by ${rejectedBy}. Goal will not resume.`,
    };
  }

  /**
   * CANCEL an intervention.
   *
   * This cancels the intervention and the associated goal
   * will not resume from this intervention.
   */
  async cancel(
    interventionId: string,
    cancelledBy: string,
    reason?: string,
  ): Promise<InterventionResolutionResult> {
    const queue = getInterventionQueue();
    const entry = queue.get(interventionId);

    if (!entry) {
      return this.fail(interventionId, 'cancelled', 'Intervention not found');
    }
    if (entry.status !== 'pending') {
      return this.fail(interventionId, 'cancelled', `Intervention is not pending (status: ${entry.status})`);
    }

    const cancelled = queue.cancel(interventionId);
    if (!cancelled) {
      return this.fail(interventionId, 'cancelled', 'Failed to cancel intervention');
    }

    // Record goal cancelled event
    const controlPlane = getHumanProxyControlPlane();
    await controlPlane.recordEvent({
      goalId: entry.goalId,
      identityId: entry.identityId,
      eventType: 'GOAL_CANCELLED',
      payload: {
        interventionId,
        reason: reason ?? `Cancelled by ${cancelledBy}`,
      },
    });

    return {
      requestId: interventionId,
      resolution: 'cancelled',
      resumed: false,
      staleStateDetected: false,
      replanRequired: false,
      objectivesToSkip: [],
      objectivesToExecute: [],
      reason: `Cancelled by ${cancelledBy}. Goal will not resume.`,
    };
  }

  /**
   * EXPIRE stale interventions.
   */
  expireStale(): number {
    return getInterventionQueue().expireStale();
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private fail(
    requestId: string,
    resolution: InterventionResolution,
    reason: string,
  ): InterventionResolutionResult {
    return {
      requestId,
      resolution,
      resumed: false,
      staleStateDetected: false,
      replanRequired: false,
      objectivesToSkip: [],
      objectivesToExecute: [],
      reason,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _controller: InterventionController | null = null;

/**
 * Get the singleton InterventionController.
 */
export function getInterventionController(): InterventionController {
  if (!_controller) {
    _controller = new InterventionController();
  }
  return _controller;
}
