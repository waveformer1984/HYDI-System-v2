/**
 * HYDI User-Facing Operational Status
 *
 * Exposes concise operational state to the user.
 * Shows operational facts, not internal reasoning or chain-of-thought.
 *
 * Example output:
 *   HYDI
 *   Status: EXECUTING
 *
 *   Goal:
 *   Bring ProtoForge online
 *
 *   Current objective:
 *   Verify service health
 *
 *   Current action:
 *   HTTP health check
 *
 *   Authorization:
 *   Authorized
 *
 *   Verification:
 *   Pending
 */

import type { GoalRuntimeStatus } from './GoalCheckpoint';

export interface OperationalStatus {
  status: OperationalPhase;
  goalId?: string;
  goalStatement?: string;
  currentObjective?: string;
  currentAction?: string;
  authorization: AuthorizationState;
  verification: VerificationState;
  waitingFor?: WaitingFor;
  lastUpdated: string;
  sessionId?: string;
}

export type OperationalPhase =
  | 'IDLE'
  | 'OBSERVING'
  | 'PLANNING'
  | 'EXECUTING'
  | 'WAITING_FOR_HUMAN'
  | 'WAITING_FOR_PROVIDER'
  | 'RECOVERING'
  | 'REPLANNING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'EXPIRED';

export type AuthorizationState = 'authorized' | 'denied' | 'pending' | 'not_required';
export type VerificationState = 'pending' | 'verified' | 'failed' | 'not_applicable';
export type WaitingFor = 'human_action' | 'provider_recovery' | 'credential_provision' | 'none';

/**
 * Render operational status as a concise user-facing string.
 * Does NOT expose chain-of-thought, internal reasoning, or secret material.
 */
export function renderOperationalStatus(status: OperationalStatus): string {
  const lines: string[] = [];
  lines.push('HYDI');
  lines.push(`Status: ${status.status}`);
  lines.push('');

  if (status.goalId && status.goalStatement) {
    lines.push('Goal:');
    lines.push(status.goalStatement);
    lines.push('');
  }

  if (status.currentObjective) {
    lines.push('Current objective:');
    lines.push(status.currentObjective);
    lines.push('');
  }

  if (status.currentAction) {
    lines.push('Current action:');
    lines.push(status.currentAction);
    lines.push('');
  }

  lines.push('Authorization:');
  lines.push(status.authorization.charAt(0).toUpperCase() + status.authorization.slice(1));
  lines.push('');

  lines.push('Verification:');
  lines.push(status.verification.charAt(0).toUpperCase() + status.verification.slice(1));

  if (status.waitingFor && status.waitingFor !== 'none') {
    lines.push('');
    lines.push('Waiting for:');
    switch (status.waitingFor) {
      case 'human_action':
        lines.push('Human action required');
        break;
      case 'provider_recovery':
        lines.push('Provider recovery');
        break;
      case 'credential_provision':
        lines.push('Credential provision');
        break;
    }
  }

  lines.push('');
  lines.push(`Last updated: ${status.lastUpdated}`);

  return lines.join('\n');
}

/**
 * Map a GoalRuntimeStatus to an OperationalPhase.
 */
export function goalStatusToPhase(status: GoalRuntimeStatus): OperationalPhase {
  switch (status) {
    case 'RUNNING': return 'EXECUTING';
    case 'PAUSED': return 'IDLE';
    case 'WAITING_FOR_HUMAN': return 'WAITING_FOR_HUMAN';
    case 'WAITING_FOR_PROVIDER': return 'WAITING_FOR_PROVIDER';
    case 'RECOVERING': return 'RECOVERING';
    case 'COMPLETED': return 'COMPLETED';
    case 'PARTIAL': return 'PARTIAL';
    case 'FAILED': return 'FAILED';
    case 'EXPIRED': return 'EXPIRED';
    default: return 'IDLE';
  }
}

/**
 * Get the current operational status from the delegated operator components.
 */
export function getOperationalStatus(params: {
  goalId?: string;
  goalStatement?: string;
  currentObjective?: string;
  currentAction?: string;
  goalStatus?: GoalRuntimeStatus;
  authorized?: boolean;
  verificationResult?: 'pending' | 'verified' | 'failed';
  waitingFor?: WaitingFor;
  sessionId?: string;
}): OperationalStatus {
  const phase = params.goalStatus ? goalStatusToPhase(params.goalStatus) : 'IDLE';

  let authorization: AuthorizationState = 'not_required';
  if (params.authorized === true) authorization = 'authorized';
  else if (params.authorized === false) authorization = 'denied';

  let verification: VerificationState = 'not_applicable';
  if (params.verificationResult === 'pending') verification = 'pending';
  else if (params.verificationResult === 'verified') verification = 'verified';
  else if (params.verificationResult === 'failed') verification = 'failed';

  return {
    status: phase,
    goalId: params.goalId,
    goalStatement: params.goalStatement,
    currentObjective: params.currentObjective,
    currentAction: params.currentAction,
    authorization,
    verification,
    waitingFor: params.waitingFor ?? 'none',
    lastUpdated: new Date().toISOString(),
    sessionId: params.sessionId,
  };
}
