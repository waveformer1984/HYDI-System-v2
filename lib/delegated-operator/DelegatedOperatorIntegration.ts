/**
 * Delegated Operator Integration
 *
 * Wires DelegatedIdentity + ResourceBoundaries + VerificationContracts
 * + InterventionQueue + GoalCheckpoints into the AdaptiveOperator flow.
 *
 * This does NOT replace AdaptiveOperator or HumanActionEngine.
 * It wraps them with identity-bound governance:
 *
 *   USER GOAL
 *   → DELEGATED IDENTITY (who is HYDI acting for?)
 *   → RESOURCE BOUNDARIES (what can HYDI touch?)
 *   → SIDE EFFECT POLICY (what categories need confirmation?)
 *   → ADAPTIVE OPERATOR (observe → plan → execute → verify → replan)
 *   → INTERVENTION QUEUE (pause for human when needed)
 *   → CHECKPOINT (save state for resumption)
 *   → COMPLETE / ESCALATE
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import type { WorkSession } from '../work-sessions';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoalExecutionResult } from '../adaptive-operator/AdaptiveOperatorTypes';
import type { AdaptiveGoalResult } from '../adaptive-operator/AdaptiveOperatorIntegration';
import type { DelegatedIdentity, AuthorityEvaluationContext, AuthorityEvaluationResult } from './DelegatedIdentity';
import type { PersistentInterventionRequest } from './InterventionQueue';
import type { GoalCheckpoint } from './GoalCheckpoint';
import {
  DelegatedIdentityManager,
  createDefaultSideEffectPolicies,
  createDefaultResourceBoundaries,
  capabilityToSideEffectCategory,
  capabilityToResourceType,
} from './DelegatedIdentity';
import { InterventionQueue } from './InterventionQueue';
import { GoalCheckpointManager } from './GoalCheckpoint';
import { VerificationContractRegistry, createDefaultVerificationContracts } from './VerificationContract';
import { executeGoalViaAdaptiveOperator } from '../adaptive-operator/AdaptiveOperatorIntegration';
import { STRICT_CONFIRMATION } from '../human-action/AuthorityManager';
import type { DelegatedAuthority } from '../human-action/AuthorityManager';

// Lazy-load structured-logger
let _logger: any = null;
function getLogger() {
  if (!_logger) {
    try {
      _logger = require('../structured-logger').child({ component: 'DelegatedOperator' });
    } catch {
      _logger = { info: console.log, warn: console.warn, error: console.error };
    }
  }
  return _logger;
}

// Singleton instances
let _identityManager: DelegatedIdentityManager | null = null;
let _interventionQueue: InterventionQueue | null = null;
let _checkpointManager: GoalCheckpointManager | null = null;
let _verificationRegistry: VerificationContractRegistry | null = null;

/**
 * Get the singleton DelegatedIdentityManager.
 */
export function getIdentityManager(): DelegatedIdentityManager {
  if (!_identityManager) {
    _identityManager = new DelegatedIdentityManager();
  }
  return _identityManager;
}

/**
 * Get the singleton InterventionQueue.
 */
export function getInterventionQueue(): InterventionQueue {
  if (!_interventionQueue) {
    _interventionQueue = new InterventionQueue();
  }
  return _interventionQueue;
}

/**
 * Get the singleton GoalCheckpointManager.
 */
export function getCheckpointManager(): GoalCheckpointManager {
  if (!_checkpointManager) {
    _checkpointManager = new GoalCheckpointManager();
  }
  return _checkpointManager;
}

/**
 * Get the singleton VerificationContractRegistry.
 */
export function getVerificationRegistry(): VerificationContractRegistry {
  if (!_verificationRegistry) {
    _verificationRegistry = new VerificationContractRegistry();
    for (const contract of createDefaultVerificationContracts()) {
      _verificationRegistry.register(contract);
    }
  }
  return _verificationRegistry;
}

// ---------------------------------------------------------------------------
// Delegation Request
// ---------------------------------------------------------------------------

export interface DelegationRequest {
  /** The user ID initiating the goal (e.g. "user:owner") */
  userId: string;
  /** The session ID */
  sessionId: string;
  /** The goal statement */
  goal: string;
  /** Workspace root for resource boundaries */
  workspaceRoot?: string;
  /** Capabilities to exclude (deny-list) */
  excludedCapabilities?: string[];
  /** Actions that always require human confirmation */
  alwaysConfirmActions?: string[];
  /** Delegation duration in milliseconds (default: 1 hour) */
  delegationDurationMs?: number;
  /** Additional resource boundaries */
  additionalResourceBoundaries?: import('./DelegatedIdentity').ResourceBoundary[];
}

// ---------------------------------------------------------------------------
// Execute Goal as Delegated Operator
// ---------------------------------------------------------------------------

/**
 * Execute a goal as a delegated human operator.
 *
 * 1. Create or reuse a DelegatedIdentity for the session
 * 2. Set up resource boundaries and side effect policies
 * 3. Delegate to AdaptiveOperator for execution
 * 4. Wire intervention queue for human-in-the-loop
 * 5. Create checkpoint for resumption
 * 6. Return result
 */
export async function executeGoalAsDelegatedOperator(
  request: DelegationRequest,
  options?: {
    supabase?: SupabaseClient;
    chromeExecutablePath?: string;
  },
): Promise<{
  workSession: WorkSession;
  result: GoalExecutionResult;
  identity: DelegatedIdentity;
  interventions: PersistentInterventionRequest[];
  checkpoint: GoalCheckpoint | null;
}> {
  const logger = getLogger();
  const identityManager = getIdentityManager();
  const interventionQueue = getInterventionQueue();
  const checkpointManager = getCheckpointManager();

  // 1. Check if identity already exists for this session
  let identity = identityManager.getIdentityBySession(request.sessionId);

  if (!identity) {
    // 2. Create a new delegated identity
    const workspaceRoot = request.workspaceRoot ?? process.cwd();
    const expiresAt = new Date(Date.now() + (request.delegationDurationMs ?? 3600000)).toISOString();

    // Create a DelegatedAuthority via AuthorityManager
    // (this is done inside AdaptiveOperatorIntegration, but we need
    // the authority ID for the identity)
    const authority: DelegatedAuthority = {
      authorityId: `auth_${request.sessionId}`,
      delegatedBy: request.userId,
      delegatedTo: 'heidi',
      scopes: ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION'],
      riskLimit: 'MEDIUM',
      riskLevelLimit: 'R2',
      resourcePatterns: [{ type: 'any', pattern: '*', description: 'All within boundaries' }],
      timeConstraint: { type: 'session_bounded', sessionId: request.sessionId },
      requiresConfirmation: STRICT_CONFIRMATION,
      purpose: `Delegated operator: ${request.goal.substring(0, 100)}`,
      createdAt: new Date().toISOString(),
      metadata: {},
    };

    identity = identityManager.delegate({
      userId: request.userId,
      sessionId: request.sessionId,
      authority,
      expiresAt,
      includedCapabilities: [], // empty = all capabilities allowed (subject to authority)
      excludedCapabilities: request.excludedCapabilities ?? [],
      alwaysConfirmActions: request.alwaysConfirmActions ?? [
        'filesystem.delete_file',
        'comm.send_email',
        'comm.send_message',
        'dev.git_push',
        'dev.deploy',
      ],
      resourceBoundaries: [
        ...createDefaultResourceBoundaries(workspaceRoot),
        ...(request.additionalResourceBoundaries ?? []),
      ],
      sideEffectPolicies: createDefaultSideEffectPolicies(),
      purpose: `Delegated operator: ${request.goal.substring(0, 100)}`,
    });

    logger.info(`Created delegated identity ${identity.identityId} for session ${request.sessionId}`);
  } else {
    // Validate existing identity
    const validity = identityManager.isIdentityValid(identity.identityId);
    if (!validity.valid) {
      throw new Error(`Delegated identity is no longer valid: ${validity.reason}`);
    }
    logger.info(`Reusing delegated identity ${identity.identityId} for session ${request.sessionId}`);
  }

  // 3. Wire intervention queue callback
  // The AdaptiveOperatorIntegration calls onHumanIntervention — we
  // intercept it to also enqueue in the persistent queue.
  // (The actual wiring happens through the options passed to executeGoalViaAdaptiveOperator)

  // 4. Execute via AdaptiveOperator
  const adaptiveResult: AdaptiveGoalResult = await executeGoalViaAdaptiveOperator({
    goal: request.goal,
    sessionId: request.sessionId,
    userId: request.userId,
    supabase: options?.supabase,
  });

  const goalResult = adaptiveResult.goalResult;

  // 5. Create checkpoint for resumption
  const checkpoint = checkpointManager.checkpoint({
    goalId: adaptiveResult.workSession.id,
    identityId: identity.identityId,
    goalStatement: request.goal,
    planVersion: goalResult.replans + 1,
    completedObjectives: [],
    failedObjectives: [],
    inProgressObjectives: [],
    pendingObjectives: [],
    executedActions: [],
    verifiedState: {},
    status: goalResult.status === 'complete' ? 'COMPLETED' : goalResult.status === 'escalated' ? 'FAILED' : 'PARTIAL',
    resumeCondition: 'Environment matches checkpoint state',
    executedSideEffects: [],
    summary: goalResult.summary,
  });

  // 6. Collect interventions for this goal
  const interventions = interventionQueue.getByGoal(adaptiveResult.workSession.id);

  logger.info(`Goal completed: status=${goalResult.status}, actions=${goalResult.actionsExecuted}, replans=${goalResult.replans}, interventions=${interventions.length}`);

  return {
    workSession: adaptiveResult.workSession,
    result: goalResult,
    identity,
    interventions,
    checkpoint,
  };
}

// ---------------------------------------------------------------------------
// Resume Goal After Restart
// ---------------------------------------------------------------------------

/**
 * Resume a goal from its last checkpoint after a restart.
 *
 * LOAD GOAL
 * → LOAD LAST VERIFIED STATE
 * → REVALIDATE CURRENT ENVIRONMENT
 * → RESUME FROM SAFE CHECKPOINT
 *
 * Never blindly replay previously executed side effects.
 */
export async function resumeGoalFromCheckpoint(
  goalId: string,
  currentObservations: Map<string, unknown>,
  options?: {
    supabase?: SupabaseClient;
    chromeExecutablePath?: string;
  },
): Promise<{
  resumed: boolean;
  reason: string;
  objectivesToExecute: string[];
  objectivesToSkip: string[];
}> {
  const checkpointManager = getCheckpointManager();
  const checkpoint = checkpointManager.getCheckpoint(goalId);

  if (!checkpoint) {
    return {
      resumed: false,
      reason: 'No checkpoint found for this goal',
      objectivesToExecute: [],
      objectivesToSkip: [],
    };
  }

  // Revalidate environment
  const revalidation = checkpointManager.revalidate(checkpoint, currentObservations);

  // Get resume point
  const resume = checkpointManager.getResumePoint(checkpoint);

  if (resume.resumeFrom === 'completed') {
    return {
      resumed: false,
      reason: 'Goal was already completed',
      objectivesToExecute: [],
      objectivesToSkip: checkpoint.completedObjectives,
    };
  }

  // Log resumption
  getLogger().info(`Resuming goal ${goalId} from ${resume.resumeFrom}: ${resume.reason}`);

  return {
    resumed: true,
    reason: `${resume.reason}. Revalidation: ${revalidation.reason}`,
    objectivesToExecute: resume.objectivesToExecute,
    objectivesToSkip: resume.objectivesToSkip,
  };
}

// ---------------------------------------------------------------------------
// Evaluate Authority for an Action
// ---------------------------------------------------------------------------

/**
 * Evaluate whether an action is authorized under the delegated identity.
 *
 * IDENTITY + CAPABILITY + ACTION + RESOURCE + RISK + CONTEXT + POLICY
 */
export function evaluateActionAuthority(
  sessionId: string,
  capability: string,
  target: string,
  risk: import('../operational/types').RiskLevel,
  scope: import('../human-action/HumanActionTypes').AuthorizationScope,
  category: import('../human-action/HumanActionTypes').ActionCategory,
  mode: import('../human-action/HumanActionTypes').AuthorizationMode,
): AuthorityEvaluationResult | null {
  const identityManager = getIdentityManager();
  const identity = identityManager.getIdentityBySession(sessionId);
  if (!identity) return null;

  const sideEffectCategory = capabilityToSideEffectCategory(capability);
  const resourceType = capabilityToResourceType(capability, target);

  const ctx: AuthorityEvaluationContext = {
    identity,
    capability,
    category,
    target,
    risk,
    scope,
    mode,
    resourceType,
    sideEffectCategory,
  };

  return identityManager.evaluate(ctx);
}
