/**
 * HYDI Failure Classifier
 *
 * Standardized failure taxonomy that drives different responses.
 * Not all failures are retryable.
 */

import { randomUUID } from 'crypto';
import type {
  FailureClassification,
  FailureRecord,
  HumanActionResult,
} from './AdaptiveOperatorTypes';

export class FailureClassifier {
  /**
   * Classify a failure from an action result.
   */
  classify(
    actionResult: HumanActionResult,
    goalId: string,
    objectiveId: string,
  ): FailureRecord {
    const classification = this.determineClassification(actionResult);
    const retryable = this.isRetryable(classification, actionResult);

    return {
      failureId: randomUUID(),
      classification,
      actionId: actionResult.actionId,
      goalId,
      objectiveId,
      description: actionResult.error ?? 'Unknown failure',
      evidence: JSON.stringify(actionResult.evidence).slice(0, 500),
      timestamp: new Date().toISOString(),
      retryable,
      recoveryStrategy: this.getRecoveryStrategy(classification),
    };
  }

  /**
   * Determine the failure classification from the action result.
   */
  private determineClassification(result: HumanActionResult): FailureClassification {
    // If the action was denied
    if (result.outcome === 'denied') {
      if (result.error?.includes('not registered') || result.error?.includes('not available')) {
        return 'CAPABILITY_UNAVAILABLE';
      }
      // Authorization errors take precedence over permission errors
      if (result.error?.includes('No authority') || result.error?.includes('Authorization') || result.error?.includes('authorization')) {
        return 'AUTHORIZATION_FAILURE';
      }
      if (result.error?.includes('permission') || result.error?.includes('Permission')) {
        return 'PERMISSION_FAILURE';
      }
      // Default denied = authorization failure (not enough authority/scope)
      return 'AUTHORIZATION_FAILURE';
    }

    // If the action is pending human intervention
    if (result.outcome === 'pending_human') {
      return 'HUMAN_INTERVENTION_REQUIRED';
    }

    // If the action was blocked
    if (result.outcome === 'blocked') {
      if (result.error?.includes('not registered') || result.error?.includes('not installed')) {
        return 'CAPABILITY_UNAVAILABLE';
      }
      if (result.error?.includes('UNSUPPORTED')) {
        return 'UNSUPPORTED_OPERATION';
      }
      return 'CAPABILITY_UNAVAILABLE';
    }

    // If execution failed
    if (result.state === 'EXECUTION_FAILED') {
      // Check for transient errors
      if (this.isTransientError(result.error)) {
        return 'TRANSIENT_FAILURE';
      }
      if (result.error?.includes('ECONNREFUSED') || result.error?.includes('ETIMEDOUT')) {
        return 'ENVIRONMENT_FAILURE';
      }
      if (result.error?.includes('provider') || result.error?.includes('API')) {
        return 'PROVIDER_FAILURE';
      }
      return 'EXECUTION_FAILURE';
    }

    // If verification failed
    if (result.state === 'VERIFICATION_FAILED' || result.state === 'ROLLBACK_FAILED') {
      return 'VERIFICATION_FAILURE';
    }

    // If we couldn't observe
    if (result.error?.includes('observe') || result.error?.includes('not found')) {
      return 'OBSERVATION_FAILURE';
    }

    return 'UNKNOWN_FAILURE';
  }

  /**
   * Determine if a failure classification is retryable.
   */
  private isRetryable(classification: FailureClassification, result: HumanActionResult): boolean {
    switch (classification) {
      case 'TRANSIENT_FAILURE':
        return true;
      case 'ENVIRONMENT_FAILURE':
        // Environment failures might be retryable if the environment changes
        return true;
      case 'PROVIDER_FAILURE':
        // Provider failures might be transient
        return true;
      case 'EXECUTION_FAILURE':
        // Check if it's a transient execution error
        return this.isTransientError(result.error);
      case 'OBSERVATION_FAILURE':
        // Might succeed on retry
        return true;
      case 'AUTHORIZATION_FAILURE':
        // Not retryable without changing authorization
        return false;
      case 'CAPABILITY_UNAVAILABLE':
        // Not retryable without installing/configuring the capability
        return false;
      case 'VERIFICATION_FAILURE':
        // Not retryable — the action succeeded but verification showed wrong state
        return false;
      case 'PERMISSION_FAILURE':
        // Not retryable without changing permissions
        return false;
      case 'HUMAN_INTERVENTION_REQUIRED':
        // Not retryable until human acts
        return false;
      case 'UNSUPPORTED_OPERATION':
        // Not retryable at all
        return false;
      case 'UNKNOWN_FAILURE':
        // Don't retry unknown failures
        return false;
      default:
        return false;
    }
  }

  /**
   * Check if an error message indicates a transient failure.
   */
  private isTransientError(error?: string | null): boolean {
    if (!error) return false;
    const transientPatterns = [
      'timeout', 'timed out', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN',
      'temporary', 'temporarily', 'retry', 'busy', 'overloaded',
      'rate limit', 'throttled', 'service unavailable',
    ];
    const lower = error.toLowerCase();
    return transientPatterns.some((p) => lower.includes(p));
  }

  /**
   * Get the recommended recovery strategy for a failure classification.
   */
  private getRecoveryStrategy(classification: FailureClassification): string | undefined {
    switch (classification) {
      case 'TRANSIENT_FAILURE':
        return 'retry_with_backoff';
      case 'ENVIRONMENT_FAILURE':
        return 'investigate_environment_then_retry';
      case 'PROVIDER_FAILURE':
        return 'check_provider_status_then_retry';
      case 'EXECUTION_FAILURE':
        return 'investigate_failure_then_replan';
      case 'OBSERVATION_FAILURE':
        return 'reobserve_with_different_method';
      case 'AUTHORIZATION_FAILURE':
        return 'request_authorization_or_work_around';
      case 'CAPABILITY_UNAVAILABLE':
        return 'install_capability_or_work_around';
      case 'VERIFICATION_FAILURE':
        return 'rollback_and_replan';
      case 'PERMISSION_FAILURE':
        return 'request_permission_or_work_around';
      case 'HUMAN_INTERVENTION_REQUIRED':
        return 'pause_and_request_human_action';
      case 'UNSUPPORTED_OPERATION':
        return 'find_alternative_approach';
      case 'UNKNOWN_FAILURE':
        return 'investigate_and_escalate';
      default:
        return undefined;
    }
  }
}

/**
 * Action Budget Tracker
 *
 * Tracks per-goal resource usage and enforces bounded autonomy.
 */
export class ActionBudgetTracker {
  private budgets: Map<string, {
    budget: import('./AdaptiveOperatorTypes').ActionBudget;
    startTime: number;
  }> = new Map();

  /**
   * Initialize a budget for a goal.
   */
  init(goalId: string, bounds: import('./AdaptiveOperatorTypes').AutonomyBounds): void {
    this.budgets.set(goalId, {
      budget: {
        goalId,
        actionsExecuted: 0,
        actionsSucceeded: 0,
        actionsFailed: 0,
        retriesUsed: 0,
        replansUsed: 0,
        externalSideEffects: 0,
        destructiveActions: 0,
        authorizationRequests: 0,
        financialExposure: 0,
        elapsedMs: 0,
        startedAt: new Date().toISOString(),
        bounds,
      },
      startTime: Date.now(),
    });
  }

  /**
   * Record an action execution.
   */
  recordAction(goalId: string, result: HumanActionResult): void {
    const entry = this.budgets.get(goalId);
    if (!entry) return;
    entry.budget.actionsExecuted++;
    if (result.verified) entry.budget.actionsSucceeded++;
    if (result.outcome === 'failure') entry.budget.actionsFailed++;
    if (result.outcome === 'pending_human') entry.budget.authorizationRequests++;
    entry.budget.lastActionAt = new Date().toISOString();
    entry.budget.elapsedMs = Date.now() - entry.startTime;
  }

  /**
   * Record a retry.
   */
  recordRetry(goalId: string): void {
    const entry = this.budgets.get(goalId);
    if (!entry) return;
    entry.budget.retriesUsed++;
  }

  /**
   * Record a replan.
   */
  recordReplan(goalId: string): void {
    const entry = this.budgets.get(goalId);
    if (!entry) return;
    entry.budget.replansUsed++;
  }

  /**
   * Record an external side effect.
   */
  recordExternalSideEffect(goalId: string): void {
    const entry = this.budgets.get(goalId);
    if (!entry) return;
    entry.budget.externalSideEffects++;
  }

  /**
   * Record a destructive action.
   */
  recordDestructiveAction(goalId: string): void {
    const entry = this.budgets.get(goalId);
    if (!entry) return;
    entry.budget.destructiveActions++;
  }

  /**
   * Check if the budget is exhausted.
   */
  isExhausted(goalId: string): { exhausted: boolean; reason?: string } {
    const entry = this.budgets.get(goalId);
    if (!entry) return { exhausted: false };
    const b = entry.budget;
    const bounds = b.bounds;

    if (b.actionsExecuted >= bounds.maxActionsPerPlan) {
      return { exhausted: true, reason: `Max actions reached (${bounds.maxActionsPerPlan})` };
    }
    if (b.replansUsed >= bounds.maxReplans) {
      return { exhausted: true, reason: `Max replans reached (${bounds.maxReplans})` };
    }
    if (b.retriesUsed >= bounds.maxRetries) {
      return { exhausted: true, reason: `Max retries reached (${bounds.maxRetries})` };
    }
    if (b.elapsedMs >= bounds.maxExecutionTimeMs) {
      return { exhausted: true, reason: `Max execution time reached (${bounds.maxExecutionTimeMs}ms)` };
    }
    if (b.externalSideEffects >= bounds.maxExternalSideEffects) {
      return { exhausted: true, reason: `Max external side effects reached (${bounds.maxExternalSideEffects})` };
    }
    if (b.destructiveActions > 0 && b.destructiveActions >= bounds.maxDestructiveActions) {
      return { exhausted: true, reason: `Max destructive actions reached (${bounds.maxDestructiveActions})` };
    }
    if (b.authorizationRequests >= bounds.maxAuthorizationRequests) {
      return { exhausted: true, reason: `Max authorization requests reached (${bounds.maxAuthorizationRequests})` };
    }
    return { exhausted: false };
  }

  /**
   * Get the budget for a goal.
   */
  get(goalId: string): import('./AdaptiveOperatorTypes').ActionBudget | null {
    return this.budgets.get(goalId)?.budget ?? null;
  }

  /**
   * Get a summary string.
   */
  summarize(goalId: string): string {
    const b = this.get(goalId);
    if (!b) return 'No budget';
    return `Budget: ${b.actionsExecuted}/${b.bounds.maxActionsPerPlan} actions, ` +
      `${b.replansUsed}/${b.bounds.maxReplans} replans, ` +
      `${b.retriesUsed}/${b.bounds.maxRetries} retries, ` +
      `${Math.round(b.elapsedMs / 1000)}s/${Math.round(b.bounds.maxExecutionTimeMs / 1000)}s`;
  }

  /**
   * Clear budget for a goal.
   */
  clear(goalId: string): void {
    this.budgets.delete(goalId);
  }
}
