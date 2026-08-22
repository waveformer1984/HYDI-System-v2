/**
 * OperationalGoalState — Canonical Control-Plane State Model
 *
 * The single, authoritative, machine-readable and human-readable projection
 * of a delegated goal's operational state.
 *
 * This is a READ-ONLY projection. It never executes actions.
 * Execution remains exclusively through the existing governed
 * HumanActionEngine / AdaptiveOperator path.
 *
 * It NEVER contains:
 *   - chain-of-thought
 *   - hidden reasoning
 *   - raw credentials
 *   - tokens, cookies, session secrets
 *   - private keys, passwords, MFA secrets
 *   - authorization headers
 *   - internal secret-bearing adapter payloads
 */

import type { GoalRuntimeStatus } from './GoalCheckpoint';
import type { AuthorizationState, VerificationState } from './OperationalStatus';

// ---------------------------------------------------------------------------
// Operational Goal State
// ---------------------------------------------------------------------------

export interface OperationalGoalState {
  // ─── Identity ───────────────────────────────────────────────────
  goalId: string;
  sessionId: string;
  delegatedIdentityId: string;
  goalText: string;

  // ─── Timing ─────────────────────────────────────────────────────
  status: GoalRuntimeStatus;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;

  // ─── Current Action ─────────────────────────────────────────────
  currentAction?: string;
  currentCapability?: string;
  targetResource?: string;
  resourceType?: string;
  riskLevel?: string;

  // ─── Authorization ──────────────────────────────────────────────
  authorizationState: AuthorizationState;
  authorizationReason?: string;

  // ─── Verification ───────────────────────────────────────────────
  verificationState: VerificationState;
  verificationContract?: string;

  // ─── Intervention ───────────────────────────────────────────────
  interventionRequired: boolean;
  interventionId?: string;
  interventionType?: string;
  interventionReason?: string;

  // ─── Checkpoint ─────────────────────────────────────────────────
  checkpointId?: string;

  // ─── Progress ───────────────────────────────────────────────────
  lastCompletedAction?: string;
  nextAction?: string;
  retryCount: number;
  replanCount: number;
  recoveryCount: number;
  actionCount: number;
  completedActionCount: number;
  failedActionCount: number;

  // ─── Side Effects ───────────────────────────────────────────────
  sideEffects: string[];

  // ─── Health ─────────────────────────────────────────────────────
  warnings: string[];
  blockers: string[];

  // ─── Final State ────────────────────────────────────────────────
  finalState?: Record<string, unknown>;
  finalVerification?: VerificationState;

  // ─── Persistence ────────────────────────────────────────────────
  persistenceState: PersistenceState;
}

export type PersistenceState =
  | 'not_persisted'
  | 'persisted'
  | 'restored'
  | 'persistence_failed';

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build an OperationalGoalState from the existing delegated-operator components.
 *
 * This pulls facts from:
 *   - GoalStateMachine (status, transitions)
 *   - GoalCheckpointManager (checkpoint, completed objectives, side effects)
 *   - InterventionQueue (intervention state)
 *   - DelegatedIdentityManager (identity validity)
 *   - VerificationContractRegistry (verification state)
 *
 * It does NOT pull from any reasoning or chain-of-thought store.
 */
export function buildOperationalGoalState(params: {
  goalId: string;
  sessionId: string;
  delegatedIdentityId: string;
  goalText: string;
  status: GoalRuntimeStatus;
  startedAt: string;
  updatedAt?: string;
  currentAction?: string;
  currentCapability?: string;
  targetResource?: string;
  resourceType?: string;
  riskLevel?: string;
  authorizationState: AuthorizationState;
  authorizationReason?: string;
  verificationState: VerificationState;
  verificationContract?: string;
  interventionRequired: boolean;
  interventionId?: string;
  interventionType?: string;
  interventionReason?: string;
  checkpointId?: string;
  lastCompletedAction?: string;
  nextAction?: string;
  retryCount?: number;
  replanCount?: number;
  recoveryCount?: number;
  actionCount?: number;
  completedActionCount?: number;
  failedActionCount?: number;
  sideEffects?: string[];
  warnings?: string[];
  blockers?: string[];
  finalState?: Record<string, unknown>;
  finalVerification?: VerificationState;
  persistenceState?: PersistenceState;
}): OperationalGoalState {
  const now = Date.now();
  const started = new Date(params.startedAt).getTime();
  const elapsedMs = now - started;

  return {
    goalId: params.goalId,
    sessionId: params.sessionId,
    delegatedIdentityId: params.delegatedIdentityId,
    goalText: params.goalText,
    status: params.status,
    startedAt: params.startedAt,
    updatedAt: params.updatedAt ?? new Date().toISOString(),
    elapsedMs,
    currentAction: params.currentAction,
    currentCapability: params.currentCapability,
    targetResource: params.targetResource,
    resourceType: params.resourceType,
    riskLevel: params.riskLevel,
    authorizationState: params.authorizationState,
    authorizationReason: params.authorizationReason,
    verificationState: params.verificationState,
    verificationContract: params.verificationContract,
    interventionRequired: params.interventionRequired,
    interventionId: params.interventionId,
    interventionType: params.interventionType,
    interventionReason: params.interventionReason,
    checkpointId: params.checkpointId,
    lastCompletedAction: params.lastCompletedAction,
    nextAction: params.nextAction,
    retryCount: params.retryCount ?? 0,
    replanCount: params.replanCount ?? 0,
    recoveryCount: params.recoveryCount ?? 0,
    actionCount: params.actionCount ?? 0,
    completedActionCount: params.completedActionCount ?? 0,
    failedActionCount: params.failedActionCount ?? 0,
    sideEffects: params.sideEffects ?? [],
    warnings: params.warnings ?? [],
    blockers: params.blockers ?? [],
    finalState: params.finalState,
    finalVerification: params.finalVerification,
    persistenceState: params.persistenceState ?? 'not_persisted',
  };
}

// ---------------------------------------------------------------------------
// Secret Sanitizer
// ---------------------------------------------------------------------------

/**
 * Patterns that must never appear in operational state.
 * Applied as defense-in-depth before any API response or dashboard render.
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /sk_live_[A-Za-z0-9]+/gi,
  /rk_live_[A-Za-z0-9]+/gi,
  /whsec_[A-Za-z0-9]+/gi,
  /AKIA[A-Z0-9]{16}/g,
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /password\s*=\s*[^\s;]+/gi,
  /secret\s*=\s*[^\s;]+/gi,
  /token\s*=\s*[^\s;]+/gi,
  /api_key\s*=\s*[^\s;]+/gi,
  /session_cookie\s*=\s*[^\s;]+/gi,
  /cookie\s*=\s*[^\s;]+/gi,
  /mfa_secret\s*=\s*[^\s;]+/gi,
  /otp\s*=\s*[^\s;]+/gi,
  /authorization\s*=\s*[^\s;]+/gi,
];

/**
 * Sanitize an OperationalGoalState, ensuring no secret material is present.
 * Returns a deep copy with [REDACTED] substituted for any matched patterns.
 */
export function sanitizeOperationalGoalState(state: OperationalGoalState): OperationalGoalState {
  const json = JSON.stringify(state);
  let sanitized = json;
  for (const pattern of FORBIDDEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return JSON.parse(sanitized) as OperationalGoalState;
}

/**
 * Verify that an OperationalGoalState contains no secret material.
 * Returns true if clean, false if forbidden patterns are found.
 */
export function isOperationalGoalStateClean(state: OperationalGoalState): boolean {
  const json = JSON.stringify(state);
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(json)) return false;
  }
  return true;
}
