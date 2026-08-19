/**
 * HYDI Recovery Outcome Classifier
 *
 * Phase 7 — Recovery Failure Intelligence
 *
 * Classifies recovery attempt outcomes and makes retry decisions.
 * This is NOT a second recovery engine or policy engine — it is a
 * classification utility used by the existing RecoveryEngine to
 * determine:
 *   1. What kind of failure occurred (if any)
 *   2. Whether retrying is useful or pointless
 *   3. What the next action should be
 *
 * The authoritative result comes from:
 *   EXECUTION + POSTCONDITION + SERVICE VERIFICATION
 *
 * A recovery command returning nonzero is not necessarily equivalent
 * to target failure. A recovery command returning zero is not
 * necessarily equivalent to system recovery.
 */

import type {
  RecoveryOutcome,
  RecoveryFailureClassification,
  RetryDecision,
  ComponentState,
  HealthEvidence,
  DependencyGraph,
} from './types';

/**
 * Classify a recovery attempt outcome based on three independent signals:
 *   - Did the execution command succeed? (did docker restart / process spawn work?)
 *   - Did the postcondition pass? (is the target component HEALTHY after?)
 *   - Did service-level verification pass? (does the REST API / health endpoint respond?)
 */
export function classifyRecoveryOutcome(params: {
  executionSucceeded: boolean;
  postconditionState: ComponentState;
  verificationSucceeded: boolean;
  dependencyBlocked: boolean;
  timedOut: boolean;
  observerUncertain: boolean;
}): RecoveryOutcome {
  // Observer uncertainty overrides everything — we cannot trust any result
  if (params.observerUncertain) {
    return 'RECOVERY_OBSERVER_UNCERTAIN';
  }

  // Timeout
  if (params.timedOut) {
    return 'RECOVERY_TIMEOUT';
  }

  // Dependency blocked — retrying the target is pointless
  if (params.dependencyBlocked) {
    return 'RECOVERY_DEPENDENCY_BLOCKED';
  }

  // Execution failed — the command itself threw an error
  if (!params.executionSucceeded) {
    return 'RECOVERY_EXECUTION_FAILED';
  }

  // Postcondition failed — command succeeded but target is still not healthy
  if (params.postconditionState !== 'HEALTHY') {
    // But if verification also failed, it might be a verification problem
    if (!params.verificationSucceeded && params.postconditionState === 'DEGRADED') {
      return 'RECOVERY_VERIFICATION_FAILED';
    }
    if (params.postconditionState === 'UNAVAILABLE' || params.postconditionState === 'FAILED') {
      return 'RECOVERY_TARGET_UNAVAILABLE';
    }
    return 'RECOVERY_POSTCONDITION_FAILED';
  }

  // Postcondition passed but verification failed — service may be running but not healthy
  if (!params.verificationSucceeded) {
    return 'RECOVERY_VERIFICATION_FAILED';
  }

  // All three signals positive
  return 'RECOVERY_SUCCESS';
}

/**
 * Classify the failure type for escalation and decision-making.
 */
export function classifyFailure(
  outcome: RecoveryOutcome,
  evidence: HealthEvidence[],
  dependencies: string[],
  depStates: Record<string, ComponentState>,
): RecoveryFailureClassification {
  switch (outcome) {
    case 'RECOVERY_SUCCESS':
    case 'RECOVERY_NOT_REQUIRED':
      return 'UNKNOWN_PROBLEM'; // no failure — shouldn't be called for success

    case 'RECOVERY_EXECUTION_FAILED':
      return 'RECOVERY_MECHANISM_PROBLEM';

    case 'RECOVERY_POSTCONDITION_FAILED':
    case 'RECOVERY_TARGET_UNAVAILABLE':
      // Check if any dependency is down — if so, it's a dependency problem
      for (const dep of dependencies) {
        const depState = depStates[dep];
        if (depState === 'UNAVAILABLE' || depState === 'FAILED') {
          return 'DEPENDENCY_PROBLEM';
        }
      }
      return 'TARGET_PROBLEM';

    case 'RECOVERY_VERIFICATION_FAILED':
      return 'VERIFICATION_PROBLEM';

    case 'RECOVERY_DEPENDENCY_BLOCKED':
      return 'DEPENDENCY_PROBLEM';

    case 'RECOVERY_TIMEOUT':
      return 'TIMEOUT_PROBLEM';

    case 'RECOVERY_OBSERVER_UNCERTAIN':
      return 'OBSERVER_PROBLEM';

    case 'RECOVERY_POLICY_DENIED':
      return 'POLICY_PROBLEM';

    case 'RECOVERY_EXHAUSTED':
      // Exhaustion is a meta-outcome — classify based on last attempt's evidence
      const hasFailEvidence = evidence.some((e) => e.status === 'fail');
      if (hasFailEvidence) return 'TARGET_PROBLEM';
      return 'UNKNOWN_PROBLEM';

    default:
      return 'UNKNOWN_PROBLEM';
  }
}

/**
 * Determine whether an outcome is retryable.
 *
 * Retryable: the failure is plausibly transient — trying again might help.
 * Non-retryable: the evidence indicates retrying cannot reasonably help.
 */
export function isRetryableOutcome(outcome: RecoveryOutcome): boolean {
  switch (outcome) {
    case 'RECOVERY_EXECUTION_FAILED':
      // Command failed — might be transient (docker daemon busy, resource contention)
      return true;

    case 'RECOVERY_POSTCONDITION_FAILED':
      // Target still unhealthy after restart — might need more time
      return true;

    case 'RECOVERY_VERIFICATION_FAILED':
      // Service-level check failed — container might need more startup time
      return true;

    case 'RECOVERY_TIMEOUT':
      // Timeout — might succeed on retry with more time
      return true;

    case 'RECOVERY_TARGET_UNAVAILABLE':
      // Target completely unavailable — retry might help if it's starting up
      return true;

    // Non-retryable outcomes:
    case 'RECOVERY_DEPENDENCY_BLOCKED':
      // Dependency is down — retrying the target is pointless
      return false;

    case 'RECOVERY_POLICY_DENIED':
      // Policy denied — retrying won't change the policy
      return false;

    case 'RECOVERY_OBSERVER_UNCERTAIN':
      // Can't trust observation — retrying based on uncertain data is dangerous
      return false;

    case 'RECOVERY_EXHAUSTED':
      // Budget exhausted — no more attempts allowed
      return false;

    case 'RECOVERY_SUCCESS':
    case 'RECOVERY_NOT_REQUIRED':
      return false; // no retry needed

    default:
      return false; // fail-closed: unknown outcomes are not retryable
  }
}

/**
 * Make a retry decision based on the outcome, attempt number, and budget.
 *
 * The decision is:
 *   - retry: when the outcome is retryable and budget remains
 *   - stop: when the outcome is non-retryable (retrying won't help)
 *   - escalate: when budget is exhausted or outcome requires human intervention
 *   - recover_dependency: when the failure is caused by a dependency problem
 *   - wait: when the target needs more time (e.g., DEGRADED but improving)
 */
export function decideRetry(params: {
  outcome: RecoveryOutcome;
  failureClassification: RecoveryFailureClassification;
  attemptNumber: number;
  maxAttempts: number;
  budgetRemaining: boolean;
  dependencies: string[];
  depStates: Record<string, ComponentState>;
  cooldownMs: number;
}): RetryDecision {
  const { outcome, failureClassification, attemptNumber, maxAttempts, budgetRemaining, dependencies, depStates, cooldownMs } = params;

  // Success — no retry needed
  if (outcome === 'RECOVERY_SUCCESS' || outcome === 'RECOVERY_NOT_REQUIRED') {
    return {
      shouldRetry: false,
      reason: 'recovery succeeded — no retry needed',
      retryableOutcome: false,
      nextAction: 'stop',
    };
  }

  // Dependency problem — switch to recovering the dependency, not retrying target
  if (failureClassification === 'DEPENDENCY_PROBLEM') {
    const failedDep = dependencies.find((dep) => {
      const state = depStates[dep];
      return state === 'UNAVAILABLE' || state === 'FAILED';
    });
    return {
      shouldRetry: false,
      reason: `recovery blocked by dependency: ${failedDep ?? 'unknown'} — must recover dependency first`,
      retryableOutcome: false,
      nextAction: 'recover_dependency',
    };
  }

  // Policy denied — stop, don't retry
  if (outcome === 'RECOVERY_POLICY_DENIED') {
    return {
      shouldRetry: false,
      reason: 'policy denied recovery — retrying will not change authorization',
      retryableOutcome: false,
      nextAction: 'escalate',
    };
  }

  // Observer uncertain — stop, don't act on uncertain data
  if (outcome === 'RECOVERY_OBSERVER_UNCERTAIN') {
    return {
      shouldRetry: false,
      reason: 'observation uncertain — cannot trust recovery result, must not retry blindly',
      retryableOutcome: false,
      nextAction: 'stop',
    };
  }

  // Budget exhausted — escalate
  if (!budgetRemaining) {
    return {
      shouldRetry: false,
      reason: `recovery budget exhausted after ${attemptNumber} attempt(s) — escalating`,
      retryableOutcome: isRetryableOutcome(outcome),
      nextAction: 'escalate',
    };
  }

  // Max attempts reached — escalate
  if (attemptNumber >= maxAttempts) {
    return {
      shouldRetry: false,
      reason: `max attempts (${maxAttempts}) reached — escalating`,
      retryableOutcome: isRetryableOutcome(outcome),
      nextAction: 'escalate',
    };
  }

  // Non-retryable outcome — stop
  if (!isRetryableOutcome(outcome)) {
    return {
      shouldRetry: false,
      reason: `outcome ${outcome} is non-retryable — retrying cannot reasonably help`,
      retryableOutcome: false,
      nextAction: 'escalate',
    };
  }

  // Retryable outcome with budget remaining — retry after cooldown
  return {
    shouldRetry: true,
    reason: `outcome ${outcome} is retryable — will retry after ${cooldownMs}ms cooldown`,
    retryableOutcome: true,
    nextAction: 'retry',
    waitMs: cooldownMs,
  };
}
