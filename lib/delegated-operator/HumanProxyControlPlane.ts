/**
 * HumanProxyControlPlane — Unified Read-Only Operational Projection
 *
 * This service is the single authoritative operational projection over the
 * existing delegated-operator systems. It NEVER executes actions itself.
 * Execution remains exclusively through the existing governed
 * HumanActionEngine / AdaptiveOperator path.
 *
 * The control plane provides methods to query:
 *   - goal state (OperationalGoalState)
 *   - active goals
 *   - goal events (OperationalEvent[])
 *   - current interventions
 *   - checkpoints
 *   - operational summary
 *   - recent failures
 *   - recent interventions
 *   - recovery history
 *
 * It uses the existing persistence mechanisms (InterventionQueue,
 * GoalCheckpointManager, OperationalEventStream) and does not duplicate
 * execution logic.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoalRuntimeStatus, GoalCheckpoint } from './GoalCheckpoint';
import type { PersistentInterventionRequest } from './InterventionQueue';
import type { OperationalGoalState, PersistenceState } from './OperationalGoalState';
import { buildOperationalGoalState, sanitizeOperationalGoalState } from './OperationalGoalState';
import type { OperationalEvent } from './OperationalEvent';
import { getOperationalEventStream, OperationalEventStream, OperationalEventPersistence } from './OperationalEvent';
import {
  getIdentityManager,
  getInterventionQueue,
  getCheckpointManager,
  getVerificationRegistry,
} from './DelegatedOperatorIntegration';
import { goalStatusToPhase, type AuthorizationState, type VerificationState } from './OperationalStatus';

/**
 * Terminal goal statuses — must match GoalStateMachine.TERMINAL_STATES.
 * A terminal goal cannot have active interventions, resume, or reopen.
 */
const TERMINAL_GOAL_STATUSES: Set<GoalRuntimeStatus> = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'EXPIRED']);

function isTerminalStatus(status: GoalRuntimeStatus): boolean {
  return TERMINAL_GOAL_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Control Plane
// ---------------------------------------------------------------------------

export class HumanProxyControlPlane {
  private supabase: SupabaseClient | null = null;
  private eventStream: OperationalEventStream;
  private eventPersistence: OperationalEventPersistence | null = null;

  constructor() {
    this.eventStream = getOperationalEventStream();
  }

  /**
   * Initialize with Supabase client for persistence-backed queries.
   */
  initialize(supabase: SupabaseClient): void {
    this.supabase = supabase;
    this.eventPersistence = new OperationalEventPersistence(supabase);
    this.eventStream.attachPersistence(this.eventPersistence);
  }

  // ─── Goal State ──────────────────────────────────────────────────

  /**
   * Get the operational state for a single goal.
   * Pulls facts from GoalStateMachine, GoalCheckpointManager,
   * InterventionQueue, and OperationalEventStream.
   */
  getGoalState(goalId: string): OperationalGoalState | null {
    const checkpointManager = getCheckpointManager();
    const interventionQueue = getInterventionQueue();
    const identityManager = getIdentityManager();
    const eventStream = this.eventStream;

    const checkpoint = checkpointManager.getCheckpoint(goalId);
    if (!checkpoint) return null;

    // Get pending interventions for this goal
    const pendingInterventions = interventionQueue.getPendingByGoal(goalId);
    const currentIntervention = pendingInterventions.length > 0 ? pendingInterventions[0] : null;

    // Get events for this goal
    const events = eventStream.getEvents(goalId);

    // Derive operational facts from events
    const actionEvents = events.filter(
      (e) => e.eventType === 'ACTION_STARTED' || e.eventType === 'ACTION_COMPLETED' || e.eventType === 'ACTION_FAILED',
    );
    const completedActions = events.filter((e) => e.eventType === 'ACTION_COMPLETED');
    const failedActions = events.filter((e) => e.eventType === 'ACTION_FAILED');
    const replanEvents = events.filter((e) => e.eventType === 'REPLAN_STARTED');
    const recoveryEvents = events.filter((e) => e.eventType === 'RECOVERY_STARTED');
    const lastAction = actionEvents.length > 0 ? actionEvents[actionEvents.length - 1] : null;
    const lastCompleted = completedActions.length > 0 ? completedActions[completedActions.length - 1] : null;
    const lastReplan = replanEvents.length > 0 ? replanEvents[replanEvents.length - 1] : null;

    // Determine authorization state from events
    let authorizationState: AuthorizationState = 'not_required';
    let authorizationReason: string | undefined;
    const lastAuthGranted = events.filter((e) => e.eventType === 'AUTHORIZATION_GRANTED').pop();
    const lastAuthDenied = events.filter((e) => e.eventType === 'AUTHORIZATION_DENIED').pop();
    if (lastAuthDenied && (!lastAuthGranted || lastAuthDenied.sequence > lastAuthGranted.sequence)) {
      authorizationState = 'denied';
      authorizationReason = lastAuthDenied.payload.authorizationReason;
    } else if (lastAuthGranted) {
      authorizationState = 'authorized';
      authorizationReason = lastAuthGranted.payload.authorizationReason;
    } else if (currentIntervention) {
      authorizationState = 'pending';
    }

    // Determine verification state from events
    let verificationState: VerificationState = 'not_applicable';
    let verificationContract: string | undefined;
    const lastVerifyPassed = events.filter((e) => e.eventType === 'VERIFICATION_PASSED').pop();
    const lastVerifyFailed = events.filter((e) => e.eventType === 'VERIFICATION_FAILED').pop();
    const lastVerifyStarted = events.filter((e) => e.eventType === 'VERIFICATION_STARTED').pop();
    if (lastVerifyFailed && (!lastVerifyPassed || lastVerifyFailed.sequence > lastVerifyPassed.sequence)) {
      verificationState = 'failed';
      verificationContract = lastVerifyFailed.payload.verificationContract;
    } else if (lastVerifyPassed) {
      verificationState = 'verified';
      verificationContract = lastVerifyPassed.payload.verificationContract;
    } else if (lastVerifyStarted) {
      verificationState = 'pending';
      verificationContract = lastVerifyStarted.payload.verificationContract;
    }

    // Determine current action from last ACTION_STARTED
    const lastActionStarted = events.filter((e) => e.eventType === 'ACTION_STARTED').pop();

    // Determine next action from last ACTION_SELECTED that hasn't completed
    // Terminal goals have no next action
    const actionSelected = events.filter((e) => e.eventType === 'ACTION_SELECTED').pop();
    const nextAction = isTerminalStatus(checkpoint.status) ? undefined : actionSelected?.payload.capability;

    // Determine persistence state
    let persistenceState: PersistenceState = 'not_persisted';
    const checkpointRestored = events.some((e) => e.eventType === 'CHECKPOINT_RESTORED');
    if (checkpointRestored) persistenceState = 'restored';
    else if (checkpoint) persistenceState = 'persisted';

    // Build the state
    const state = buildOperationalGoalState({
      goalId,
      sessionId: checkpoint.identityId ? checkpoint.identityId : '',
      delegatedIdentityId: checkpoint.identityId,
      goalText: checkpoint.goalStatement,
      status: checkpoint.status,
      startedAt: checkpoint.createdAt,
      // Terminal goals have no current action
      currentAction: isTerminalStatus(checkpoint.status) ? undefined : lastActionStarted?.payload.capability,
      currentCapability: isTerminalStatus(checkpoint.status) ? undefined : lastActionStarted?.payload.capability,
      targetResource: isTerminalStatus(checkpoint.status) ? undefined : lastActionStarted?.payload.targetResource,
      resourceType: isTerminalStatus(checkpoint.status) ? undefined : lastActionStarted?.payload.resourceType,
      riskLevel: isTerminalStatus(checkpoint.status) ? undefined : lastActionStarted?.payload.riskLevel,
      authorizationState,
      authorizationReason,
      verificationState,
      verificationContract,
      // Terminal goals cannot have active interventions — suppress orphaned pending interventions
      interventionRequired: !isTerminalStatus(checkpoint.status) && currentIntervention !== null,
      interventionId: !isTerminalStatus(checkpoint.status) ? currentIntervention?.requestId : undefined,
      interventionType: !isTerminalStatus(checkpoint.status) ? currentIntervention?.interventionType : undefined,
      interventionReason: !isTerminalStatus(checkpoint.status) ? currentIntervention?.blocker : undefined,
      checkpointId: checkpoint.checkpointId,
      lastCompletedAction: lastCompleted?.payload.capability,
      nextAction,
      retryCount: failedActions.length,
      replanCount: replanEvents.length,
      recoveryCount: recoveryEvents.length,
      actionCount: actionEvents.length,
      completedActionCount: completedActions.length,
      failedActionCount: failedActions.length,
      sideEffects: checkpoint.executedSideEffects,
      warnings: checkpoint.failedObjectives.length > 0 ? [`Failed objectives: ${checkpoint.failedObjectives.join(', ')}`] : [],
      blockers: !isTerminalStatus(checkpoint.status) && currentIntervention ? [currentIntervention.blocker] : [],
      finalState: checkpoint.status === 'COMPLETED' ? checkpoint.verifiedState : undefined,
      finalVerification: checkpoint.status === 'COMPLETED' ? 'verified' : undefined,
      persistenceState,
    });

    // Sanitize before returning
    return sanitizeOperationalGoalState(state);
  }

  // ─── Active Goals ────────────────────────────────────────────────

  /**
   * List all active goals (non-terminal status).
   */
  listActiveGoals(): OperationalGoalState[] {
    const checkpointManager = getCheckpointManager();
    const activeCheckpoints = checkpointManager.listActive();

    const states: OperationalGoalState[] = [];
    for (const cp of activeCheckpoints) {
      const state = this.getGoalState(cp.goalId);
      if (state) states.push(state);
    }
    return states;
  }

  // ─── Goal Events ─────────────────────────────────────────────────

  /**
   * Get the operational event stream for a goal.
   */
  getGoalEvents(goalId: string): OperationalEvent[] {
    return this.eventStream.getEvents(goalId);
  }

  // ─── Interventions ───────────────────────────────────────────────

  /**
   * Get the current pending intervention for a goal.
   */
  getCurrentIntervention(goalId: string): PersistentInterventionRequest | null {
    const queue = getInterventionQueue();
    const pending = queue.getPendingByGoal(goalId);
    return pending.length > 0 ? pending[0] : null;
  }

  /**
   * List all pending interventions across all goals.
   * Filters out interventions for terminal goals (orphaned interventions).
   */
  listPendingInterventions(): PersistentInterventionRequest[] {
    const queue = getInterventionQueue();
    const checkpointManager = getCheckpointManager();
    return queue.getPending().filter((intv) => {
      const cp = checkpointManager.getCheckpoint(intv.goalId);
      // If no checkpoint exists, keep the intervention (may be a new goal)
      // If checkpoint exists and is terminal, filter it out (orphaned)
      if (!cp) return true;
      return !isTerminalStatus(cp.status);
    });
  }

  /**
   * Get recent interventions (including resolved/cancelled/expired).
   */
  async getRecentInterventions(limit: number = 20): Promise<PersistentInterventionRequest[]> {
    if (!this.supabase) return getInterventionQueue().getPending();
    try {
      const { data, error } = await this.supabase
        .from('human_intervention_requests')
        .select('*')
        .order('requested_at', { ascending: false })
        .limit(limit);
      if (error || !data) return getInterventionQueue().getPending();
      return data as PersistentInterventionRequest[];
    } catch {
      return getInterventionQueue().getPending();
    }
  }

  // ─── Checkpoints ─────────────────────────────────────────────────

  /**
   * Get the checkpoint for a goal.
   */
  getCheckpoint(goalId: string): GoalCheckpoint | null {
    return getCheckpointManager().getCheckpoint(goalId);
  }

  // ─── Summary ─────────────────────────────────────────────────────

  /**
   * Get an operational summary across all active goals.
   */
  getOperationalSummary(): {
    activeGoals: number;
    pendingInterventions: number;
    completedGoals: number;
    failedGoals: number;
    totalActions: number;
    totalReplans: number;
    totalRecoveries: number;
    recentEvents: OperationalEvent[];
  } {
    const activeGoals = this.listActiveGoals();
    const pendingInterventions = this.listPendingInterventions();
    const recentEvents = this.eventStream.getRecentEvents(20);

    let totalActions = 0;
    let totalReplans = 0;
    let totalRecoveries = 0;
    let completedGoals = 0;
    let failedGoals = 0;

    // Count active goal metrics
    for (const goal of activeGoals) {
      totalActions += goal.actionCount;
      totalReplans += goal.replanCount;
      totalRecoveries += goal.recoveryCount;
    }

    // Count terminal goals from all checkpoints
    const allCheckpoints = getCheckpointManager().getAllCheckpoints();
    for (const cp of allCheckpoints) {
      if (cp.status === 'COMPLETED') completedGoals++;
      else if (cp.status === 'FAILED' || cp.status === 'EXPIRED') failedGoals++;
    }

    return {
      activeGoals: activeGoals.length,
      pendingInterventions: pendingInterventions.length,
      completedGoals,
      failedGoals,
      totalActions,
      totalReplans,
      totalRecoveries,
      recentEvents,
    };
  }

  // ─── Recent Failures ─────────────────────────────────────────────

  /**
   * Get recent failure events across all goals.
   */
  getRecentFailures(limit: number = 20): OperationalEvent[] {
    const recent = this.eventStream.getRecentEvents(limit * 5);
    return recent
      .filter(
        (e) =>
          e.eventType === 'ACTION_FAILED' ||
          e.eventType === 'VERIFICATION_FAILED' ||
          e.eventType === 'GOAL_FAILED' ||
          e.eventType === 'STALE_STATE_DETECTED',
      )
      .slice(0, limit);
  }

  // ─── Recovery History ────────────────────────────────────────────

  /**
   * Get recovery history for a goal.
   */
  getRecoveryHistory(goalId: string): OperationalEvent[] {
    const events = this.eventStream.getEvents(goalId);
    return events.filter(
      (e) =>
        e.eventType === 'RECOVERY_STARTED' ||
        e.eventType === 'RECOVERY_COMPLETED' ||
        e.eventType === 'CHECKPOINT_RESTORED' ||
        e.eventType === 'STALE_STATE_DETECTED',
    );
  }

  // ─── Event Recording (for use by the execution layer) ────────────

  /**
   * Record an operational event.
   * This is called by the execution layer (AdaptiveOperator, HumanActionEngine)
   * to notify the control plane of state changes.
   *
   * The control plane NEVER triggers execution — it only records and projects.
   */
  async recordEvent(params: {
    goalId: string;
    sessionId?: string;
    identityId?: string;
    eventType: OperationalEvent['eventType'];
    payload?: OperationalEvent['payload'];
    idempotencyKey?: string;
  }): Promise<OperationalEvent> {
    return this.eventStream.record(params);
  }

  // ─── Restore After Restart ───────────────────────────────────────

  /**
   * Restore event history from Supabase after restart.
   */
  async restoreFromPersistence(goalIds?: string[]): Promise<number> {
    return this.eventStream.restoreFromPersistence(goalIds);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _controlPlane: HumanProxyControlPlane | null = null;

/**
 * Get the singleton HumanProxyControlPlane.
 */
export function getHumanProxyControlPlane(): HumanProxyControlPlane {
  if (!_controlPlane) {
    _controlPlane = new HumanProxyControlPlane();
  }
  return _controlPlane;
}
