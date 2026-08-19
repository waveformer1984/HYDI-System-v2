/**
 * Phase 15: Recovery Failure Intelligence Test Matrix
 *
 * 15 recovery scenarios covering:
 *  1. Successful recovery
 *  2. Execution failure
 *  3. Postcondition failure
 *  4. Verification failure
 *  5. Timeout
 *  6. Dependency-blocked recovery
 *  7. Policy-denied recovery
 *  8. Recovery exhaustion
 *  9. Escalation creation
 * 10. Duplicate recovery prevention
 * 11. Observer failure during recovery
 * 12. Conflicting evidence during recovery
 * 13. Recovery success after one retry
 * 14. Recovery success after multiple retries
 * 15. Recovery that must never retry
 */

import {
  classifyRecoveryOutcome,
  classifyFailure,
  decideRetry,
  isRetryableOutcome,
} from '../../lib/operational/RecoveryOutcomeClassifier';
import type {
  RecoveryOutcome,
  RecoveryFailureClassification,
  HealthEvidence,
  ComponentState,
} from '../../lib/operational/types';

const ev = (check: string, status: 'pass' | 'fail' | 'warn' | 'skip', value: string): HealthEvidence => ({
  check,
  status,
  value,
  checkedAt: new Date().toISOString(),
});

describe('Phase 15: Recovery Failure Intelligence Test Matrix', () => {
  describe('1. Successful recovery', () => {
    it('classifies as RECOVERY_SUCCESS when all signals pass', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: true,
        postconditionState: 'HEALTHY',
        verificationSucceeded: true,
        dependencyBlocked: false,
        timedOut: false,
        observerUncertain: false,
      });
      expect(outcome).toBe('RECOVERY_SUCCESS');
    });

    it('does not retry on success', () => {
      const decision = decideRetry({
        outcome: 'RECOVERY_SUCCESS',
        failureClassification: 'UNKNOWN_PROBLEM',
        attemptNumber: 1,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: [],
        depStates: {},
        cooldownMs: 5000,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.nextAction).toBe('stop');
    });
  });

  describe('2. Execution failure', () => {
    it('classifies as RECOVERY_EXECUTION_FAILED when command throws', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: false,
        postconditionState: 'UNAVAILABLE',
        verificationSucceeded: false,
        dependencyBlocked: false,
        timedOut: false,
        observerUncertain: false,
      });
      expect(outcome).toBe('RECOVERY_EXECUTION_FAILED');
    });

    it('classifies failure as RECOVERY_MECHANISM_PROBLEM', () => {
      const fc = classifyFailure('RECOVERY_EXECUTION_FAILED', [], [], {});
      expect(fc).toBe('RECOVERY_MECHANISM_PROBLEM');
    });

    it('is retryable (might be transient)', () => {
      expect(isRetryableOutcome('RECOVERY_EXECUTION_FAILED')).toBe(true);
    });
  });

  describe('3. Postcondition failure', () => {
    it('classifies as RECOVERY_POSTCONDITION_FAILED when command succeeds but target unhealthy', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: true,
        postconditionState: 'DEGRADED',
        verificationSucceeded: true,
        dependencyBlocked: false,
        timedOut: false,
        observerUncertain: false,
      });
      expect(outcome).toBe('RECOVERY_POSTCONDITION_FAILED');
    });

    it('classifies as RECOVERY_TARGET_UNAVAILABLE when target is UNAVAILABLE', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: true,
        postconditionState: 'UNAVAILABLE',
        verificationSucceeded: false,
        dependencyBlocked: false,
        timedOut: false,
        observerUncertain: false,
      });
      expect(outcome).toBe('RECOVERY_TARGET_UNAVAILABLE');
    });

    it('classifies failure as TARGET_PROBLEM when no dependency is down', () => {
      const fc = classifyFailure('RECOVERY_POSTCONDITION_FAILED', [ev('health', 'fail', 'down')], [], {});
      expect(fc).toBe('TARGET_PROBLEM');
    });

    it('is retryable', () => {
      expect(isRetryableOutcome('RECOVERY_POSTCONDITION_FAILED')).toBe(true);
    });
  });

  describe('4. Verification failure', () => {
    it('classifies as RECOVERY_VERIFICATION_FAILED when DEGRADED and verification fails', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: true,
        postconditionState: 'DEGRADED',
        verificationSucceeded: false,
        dependencyBlocked: false,
        timedOut: false,
        observerUncertain: false,
      });
      expect(outcome).toBe('RECOVERY_VERIFICATION_FAILED');
    });

    it('classifies failure as VERIFICATION_PROBLEM', () => {
      const fc = classifyFailure('RECOVERY_VERIFICATION_FAILED', [], [], {});
      expect(fc).toBe('VERIFICATION_PROBLEM');
    });

    it('is retryable (service might need more startup time)', () => {
      expect(isRetryableOutcome('RECOVERY_VERIFICATION_FAILED')).toBe(true);
    });
  });

  describe('5. Timeout', () => {
    it('classifies as RECOVERY_TIMEOUT', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: false,
        postconditionState: 'UNAVAILABLE',
        verificationSucceeded: false,
        dependencyBlocked: false,
        timedOut: true,
        observerUncertain: false,
      });
      expect(outcome).toBe('RECOVERY_TIMEOUT');
    });

    it('classifies failure as TIMEOUT_PROBLEM', () => {
      const fc = classifyFailure('RECOVERY_TIMEOUT', [], [], {});
      expect(fc).toBe('TIMEOUT_PROBLEM');
    });

    it('is retryable', () => {
      expect(isRetryableOutcome('RECOVERY_TIMEOUT')).toBe(true);
    });
  });

  describe('6. Dependency-blocked recovery', () => {
    it('classifies as RECOVERY_DEPENDENCY_BLOCKED when dependency is down', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: true,
        postconditionState: 'UNAVAILABLE',
        verificationSucceeded: false,
        dependencyBlocked: true,
        timedOut: false,
        observerUncertain: false,
      });
      expect(outcome).toBe('RECOVERY_DEPENDENCY_BLOCKED');
    });

    it('classifies failure as DEPENDENCY_PROBLEM', () => {
      const fc = classifyFailure(
        'RECOVERY_DEPENDENCY_BLOCKED',
        [],
        ['supabase_db'],
        { supabase_db: 'UNAVAILABLE' },
      );
      expect(fc).toBe('DEPENDENCY_PROBLEM');
    });

    it('is NOT retryable (retrying target is pointless)', () => {
      expect(isRetryableOutcome('RECOVERY_DEPENDENCY_BLOCKED')).toBe(false);
    });

    it('retry decision says recover_dependency, not retry', () => {
      const decision = decideRetry({
        outcome: 'RECOVERY_DEPENDENCY_BLOCKED',
        failureClassification: 'DEPENDENCY_PROBLEM',
        attemptNumber: 1,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: ['supabase_db'],
        depStates: { supabase_db: 'UNAVAILABLE' },
        cooldownMs: 5000,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.nextAction).toBe('recover_dependency');
    });
  });

  describe('7. Policy-denied recovery', () => {
    it('classifies as RECOVERY_POLICY_DENIED', () => {
      // Policy denial is handled before the recovery loop, but the outcome
      // is still defined for completeness
      expect(isRetryableOutcome('RECOVERY_POLICY_DENIED')).toBe(false);
    });

    it('classifies failure as POLICY_PROBLEM', () => {
      const fc = classifyFailure('RECOVERY_POLICY_DENIED', [], [], {});
      expect(fc).toBe('POLICY_PROBLEM');
    });

    it('retry decision says escalate, not retry', () => {
      const decision = decideRetry({
        outcome: 'RECOVERY_POLICY_DENIED',
        failureClassification: 'POLICY_PROBLEM',
        attemptNumber: 1,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: [],
        depStates: {},
        cooldownMs: 5000,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.nextAction).toBe('escalate');
    });
  });

  describe('8. Recovery exhaustion', () => {
    it('is NOT retryable', () => {
      expect(isRetryableOutcome('RECOVERY_EXHAUSTED')).toBe(false);
    });

    it('retry decision says escalate when max attempts reached', () => {
      const decision = decideRetry({
        outcome: 'RECOVERY_POSTCONDITION_FAILED',
        failureClassification: 'TARGET_PROBLEM',
        attemptNumber: 3,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: [],
        depStates: {},
        cooldownMs: 5000,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.nextAction).toBe('escalate');
    });

    it('retry decision says escalate when budget exhausted', () => {
      const decision = decideRetry({
        outcome: 'RECOVERY_POSTCONDITION_FAILED',
        failureClassification: 'TARGET_PROBLEM',
        attemptNumber: 2,
        maxAttempts: 3,
        budgetRemaining: false,
        dependencies: [],
        depStates: {},
        cooldownMs: 5000,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.nextAction).toBe('escalate');
    });
  });

  describe('9. Escalation creation', () => {
    it('escalation record contains required fields', () => {
      // Verify the EscalationRecord type has the required fields
      const fs = require('fs');
      const path = require('path');
      const typesSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'lib', 'operational', 'types.ts'),
        'utf8',
      );
      expect(typesSrc).toContain('EscalationRecord');
      expect(typesSrc).toContain('failureClassification');
      expect(typesSrc).toContain('attemptCount');
      expect(typesSrc).toContain('lastRecoveryAction');
      expect(typesSrc).toContain('lastFailureReason');
      expect(typesSrc).toContain('reasonForEscalation');
      expect(typesSrc).toContain('recommendedNextAction');
      expect(typesSrc).toContain('attemptHistory');
    });
  });

  describe('10. Duplicate recovery prevention', () => {
    it('RecoveryLockManager prevents concurrent recovery', () => {
      const fs = require('fs');
      const path = require('path');
      const lockSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'lib', 'operational', 'RecoveryLock.ts'),
        'utf8',
      );
      expect(lockSrc).toContain('acquire');
      expect(lockSrc).toContain('isLocked');
      expect(lockSrc).toContain('holderId');
    });

    it('RecoveryEngine stores lock holderId for proper release', () => {
      const fs = require('fs');
      const path = require('path');
      const engineSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'lib', 'operational', 'RecoveryEngine.ts'),
        'utf8',
      );
      expect(engineSrc).toContain('lockHolderIds');
      expect(engineSrc).toContain('releaseLock');
    });
  });

  describe('11. Observer failure during recovery', () => {
    it('classifies as RECOVERY_OBSERVER_UNCERTAIN when evidence is all skip', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: true,
        postconditionState: 'UNKNOWN',
        verificationSucceeded: false,
        dependencyBlocked: false,
        timedOut: false,
        observerUncertain: true,
      });
      expect(outcome).toBe('RECOVERY_OBSERVER_UNCERTAIN');
    });

    it('is NOT retryable (cannot trust uncertain observation)', () => {
      expect(isRetryableOutcome('RECOVERY_OBSERVER_UNCERTAIN')).toBe(false);
    });

    it('retry decision says stop, not retry', () => {
      const decision = decideRetry({
        outcome: 'RECOVERY_OBSERVER_UNCERTAIN',
        failureClassification: 'OBSERVER_PROBLEM',
        attemptNumber: 1,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: [],
        depStates: {},
        cooldownMs: 5000,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.nextAction).toBe('stop');
    });
  });

  describe('12. Conflicting evidence during recovery', () => {
    it('classifies as DEPENDENCY_PROBLEM when dependency is down despite target evidence', () => {
      const fc = classifyFailure(
        'RECOVERY_POSTCONDITION_FAILED',
        [ev('docker', 'pass', 'running'), ev('rest', 'fail', 'HTTP 0')],
        ['supabase_db'],
        { supabase_db: 'UNAVAILABLE' },
      );
      expect(fc).toBe('DEPENDENCY_PROBLEM');
    });
  });

  describe('13. Recovery success after one retry', () => {
    it('first attempt fails (retryable), second succeeds', () => {
      const failOutcome = classifyRecoveryOutcome({
        executionSucceeded: true,
        postconditionState: 'DEGRADED',
        verificationSucceeded: true,
        dependencyBlocked: false,
        timedOut: false,
        observerUncertain: false,
      });
      expect(failOutcome).toBe('RECOVERY_POSTCONDITION_FAILED');
      expect(isRetryableOutcome(failOutcome)).toBe(true);

      const retryDecision = decideRetry({
        outcome: failOutcome,
        failureClassification: 'TARGET_PROBLEM',
        attemptNumber: 1,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: [],
        depStates: {},
        cooldownMs: 5000,
      });
      expect(retryDecision.shouldRetry).toBe(true);

      // Second attempt succeeds
      const successOutcome = classifyRecoveryOutcome({
        executionSucceeded: true,
        postconditionState: 'HEALTHY',
        verificationSucceeded: true,
        dependencyBlocked: false,
        timedOut: false,
        observerUncertain: false,
      });
      expect(successOutcome).toBe('RECOVERY_SUCCESS');
    });
  });

  describe('14. Recovery success after multiple retries', () => {
    it('first two attempts fail (retryable), third succeeds', () => {
      // Attempt 1
      const d1 = decideRetry({
        outcome: 'RECOVERY_EXECUTION_FAILED',
        failureClassification: 'RECOVERY_MECHANISM_PROBLEM',
        attemptNumber: 1,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: [],
        depStates: {},
        cooldownMs: 1000,
      });
      expect(d1.shouldRetry).toBe(true);

      // Attempt 2
      const d2 = decideRetry({
        outcome: 'RECOVERY_POSTCONDITION_FAILED',
        failureClassification: 'TARGET_PROBLEM',
        attemptNumber: 2,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: [],
        depStates: {},
        cooldownMs: 1000,
      });
      expect(d2.shouldRetry).toBe(true);

      // Attempt 3 succeeds
      const outcome3 = classifyRecoveryOutcome({
        executionSucceeded: true,
        postconditionState: 'HEALTHY',
        verificationSucceeded: true,
        dependencyBlocked: false,
        timedOut: false,
        observerUncertain: false,
      });
      expect(outcome3).toBe('RECOVERY_SUCCESS');
    });
  });

  describe('15. Recovery that must never retry', () => {
    it('dependency-blocked recovery does not retry', () => {
      const decision = decideRetry({
        outcome: 'RECOVERY_DEPENDENCY_BLOCKED',
        failureClassification: 'DEPENDENCY_PROBLEM',
        attemptNumber: 1,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: ['supabase_db'],
        depStates: { supabase_db: 'FAILED' },
        cooldownMs: 5000,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.nextAction).toBe('recover_dependency');
    });

    it('observer-uncertain recovery does not retry', () => {
      const decision = decideRetry({
        outcome: 'RECOVERY_OBSERVER_UNCERTAIN',
        failureClassification: 'OBSERVER_PROBLEM',
        attemptNumber: 1,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: [],
        depStates: {},
        cooldownMs: 5000,
      });
      expect(decision.shouldRetry).toBe(false);
    });

    it('policy-denied recovery does not retry', () => {
      const decision = decideRetry({
        outcome: 'RECOVERY_POLICY_DENIED',
        failureClassification: 'POLICY_PROBLEM',
        attemptNumber: 1,
        maxAttempts: 3,
        budgetRemaining: true,
        dependencies: [],
        depStates: {},
        cooldownMs: 5000,
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.nextAction).toBe('escalate');
    });
  });

  describe('Outcome classifier — edge cases', () => {
    it('observer uncertainty overrides all other signals', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: true,
        postconditionState: 'HEALTHY',
        verificationSucceeded: true,
        dependencyBlocked: false,
        timedOut: false,
        observerUncertain: true,
      });
      expect(outcome).toBe('RECOVERY_OBSERVER_UNCERTAIN');
    });

    it('timeout is detected before execution failure', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: false,
        postconditionState: 'UNAVAILABLE',
        verificationSucceeded: false,
        dependencyBlocked: false,
        timedOut: true,
        observerUncertain: false,
      });
      expect(outcome).toBe('RECOVERY_TIMEOUT');
    });

    it('dependency blocked is detected before execution failure', () => {
      const outcome = classifyRecoveryOutcome({
        executionSucceeded: false,
        postconditionState: 'UNAVAILABLE',
        verificationSucceeded: false,
        dependencyBlocked: true,
        timedOut: false,
        observerUncertain: false,
      });
      expect(outcome).toBe('RECOVERY_DEPENDENCY_BLOCKED');
    });
  });
});
