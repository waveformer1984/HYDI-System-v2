/**
 * Phase 4 — Action Selector, Recovery Budget, Recovery Lock, & State Machine Tests
 *
 * Tests:
 * - Action selection: healthy → NO_ACTION (idempotent)
 * - Action selection: unavailable → recovery action selected
 * - Action selection: denied for unknown targets (no scope creep)
 * - Action selection: escalation for exhausted budget
 * - Recovery budget: retry limit enforced
 * - Recovery budget: circuit breaker trips after threshold
 * - Recovery lock: prevents concurrent recovery
 * - State machine: legal transitions allowed
 * - State machine: illegal transitions rejected
 * - State machine: ESCALATION_REQUIRED state
 */

import { ActionSelector } from '../../lib/operational/ActionSelector';
import { AutonomyPolicyModel, autonomyPolicyModel } from '../../lib/operational/AutonomyPolicyModel';
import { RiskClassifier, riskClassifier } from '../../lib/operational/RiskClassifier';
import { RecoveryBudgetManager } from '../../lib/operational/RecoveryBudget';
import { RecoveryLockManager } from '../../lib/operational/RecoveryLock';
import { StateMachine, stateMachine } from '../../lib/operational/StateMachine';
import { CapabilityAuthorizer } from '../../lib/operational/CapabilityAuthorizer';
import { SystemStateModel } from '../../lib/operational/SystemStateModel';
import { DependencyGraphBuilder } from '../../lib/operational/DependencyGraphBuilder';
import type { ComponentHealth } from '../../lib/operational/types';
import path from 'path';

describe('Phase 4 — StateMachine', () => {
  const sm = stateMachine;

  it('allows HEALTHY → UNAVAILABLE', () => {
    expect(sm.isLegalTransition('HEALTHY', 'UNAVAILABLE')).toBe(true);
  });

  it('allows UNAVAILABLE → RECOVERING', () => {
    expect(sm.isLegalTransition('UNAVAILABLE', 'RECOVERING')).toBe(true);
  });

  it('allows RECOVERING → HEALTHY', () => {
    expect(sm.isLegalTransition('RECOVERING', 'HEALTHY')).toBe(true);
  });

  it('allows FAILED → ESCALATION_REQUIRED', () => {
    expect(sm.isLegalTransition('FAILED', 'ESCALATION_REQUIRED')).toBe(true);
  });

  it('allows ESCALATION_REQUIRED → RECOVERING', () => {
    expect(sm.isLegalTransition('ESCALATION_REQUIRED', 'RECOVERING')).toBe(true);
  });

  it('rejects HEALTHY → RECOVERING (no recovery needed when healthy)', () => {
    expect(sm.isLegalTransition('HEALTHY', 'RECOVERING')).toBe(false);
  });

  it('rejects HEALTHY → FAILED (must go through UNAVAILABLE)', () => {
    expect(sm.isLegalTransition('HEALTHY', 'FAILED')).toBe(false);
  });

  it('throws on illegal transition in validateTransition', () => {
    expect(() => sm.validateTransition('HEALTHY', 'FAILED')).toThrow();
  });

  it('same-state transitions are always legal', () => {
    expect(sm.isLegalTransition('HEALTHY', 'HEALTHY')).toBe(true);
    expect(sm.isLegalTransition('UNAVAILABLE', 'UNAVAILABLE')).toBe(true);
  });
});

describe('Phase 4 — RecoveryBudgetManager', () => {
  let model: SystemStateModel;
  let budget: RecoveryBudgetManager;

  beforeEach(() => {
    model = new SystemStateModel();
    budget = new RecoveryBudgetManager(model, {
      maxRetriesPerComponent: 2,
      circuitBreakerThreshold: 3,
      circuitBreakerCooldownMs: 300000,
    });
  });

  it('allows recovery within budget', () => {
    const result = budget.canRecover('protoforge-core', 'incident-1');
    expect(result.allowed).toBe(true);
  });

  it('denies recovery after retry budget exhausted', () => {
    budget.recordAttempt('protoforge-core', 'incident-1', false);
    budget.recordAttempt('protoforge-core', 'incident-1', false);
    const result = budget.canRecover('protoforge-core', 'incident-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('retry budget exhausted');
  });

  it('trips circuit breaker after threshold consecutive failures', () => {
    budget.recordAttempt('protoforge-core', 'incident-1', false);
    budget.recordAttempt('protoforge-core', 'incident-1', false);
    budget.recordAttempt('protoforge-core', 'incident-1', false);

    expect(budget.isCircuitBreakerTripped('protoforge-core')).toBe(true);

    const result = budget.canRecover('protoforge-core', 'incident-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('circuit breaker');
  });

  it('resets consecutive failures on success', () => {
    budget.recordAttempt('protoforge-core', 'incident-1', false);
    budget.recordAttempt('protoforge-core', 'incident-1', false);
    budget.recordAttempt('protoforge-core', 'incident-1', true); // success

    expect(budget.isCircuitBreakerTripped('protoforge-core')).toBe(false);
    expect(budget.getStats('protoforge-core').consecutiveFailures).toBe(0);
  });

  it('tracks total attempts and successes', () => {
    budget.recordAttempt('protoforge-core', 'incident-1', false);
    budget.recordAttempt('protoforge-core', 'incident-1', true);
    budget.recordAttempt('protoforge-core', 'incident-1', false);

    const stats = budget.getStats('protoforge-core');
    expect(stats.totalAttempts).toBe(3);
    expect(stats.totalSuccesses).toBe(1);
  });
});

describe('Phase 4 — RecoveryLockManager', () => {
  let model: SystemStateModel;
  let lockManager: RecoveryLockManager;

  beforeEach(() => {
    model = new SystemStateModel();
    lockManager = new RecoveryLockManager(model, 60000);
  });

  it('acquires a lock for a component', () => {
    const lease = lockManager.acquire('protoforge-core');
    expect(lease).not.toBeNull();
    expect(lease!.component).toBe('protoforge-core');
    expect(lease!.active).toBe(true);
  });

  it('prevents concurrent recovery — second acquire returns null', () => {
    const lease1 = lockManager.acquire('protoforge-core');
    expect(lease1).not.toBeNull();

    const lease2 = lockManager.acquire('protoforge-core');
    expect(lease2).toBeNull();
  });

  it('reports component as locked after acquire', () => {
    lockManager.acquire('protoforge-core');
    expect(lockManager.isLocked('protoforge-core')).toBe(true);
  });

  it('releases lock and allows re-acquire', () => {
    const lease = lockManager.acquire('protoforge-core')!;
    expect(lockManager.isLocked('protoforge-core')).toBe(true);

    lockManager.release('protoforge-core', lease.holderId);
    expect(lockManager.isLocked('protoforge-core')).toBe(false);

    const lease2 = lockManager.acquire('protoforge-core');
    expect(lease2).not.toBeNull();
  });

  it('tracks active leases', () => {
    lockManager.acquire('protoforge-core');
    lockManager.acquire('heidi-web');

    const active = lockManager.getActiveLeases();
    expect(active).toHaveLength(2);
  });
});

describe('Phase 4 — ActionSelector', () => {
  let model: SystemStateModel;
  let selector: ActionSelector;
  let budget: RecoveryBudgetManager;
  let authorizer: CapabilityAuthorizer;
  const root = path.resolve(__dirname, '..', '..');

  beforeEach(() => {
    const graphBuilder = new DependencyGraphBuilder(root);
    const graph = graphBuilder.build();
    model = new SystemStateModel();
    for (const [id, node] of graph.nodes) {
      model.registerComponent(id, node.category);
    }
    authorizer = new CapabilityAuthorizer(model);
    budget = new RecoveryBudgetManager(model, { maxRetriesPerComponent: 2, circuitBreakerThreshold: 3, circuitBreakerCooldownMs: 300000 });
    const policyModel = new AutonomyPolicyModel();
    const classifier = new RiskClassifier();
    selector = new ActionSelector(policyModel, classifier, authorizer, budget, model);
  });

  function setComponentState(component: string, state: string, evidence: Array<{ check: string; status: string }> = []) {
    model.updateState(component, state as ComponentHealth['state'], evidence.map((e) => ({
      check: e.check,
      status: e.status as 'pass' | 'fail',
      value: 'test',
      checkedAt: new Date().toISOString(),
    })));
  }

  it('selects NO_ACTION when component is HEALTHY (idempotent)', () => {
    setComponentState('protoforge-core', 'HEALTHY');
    const health = model.getState('protoforge-core');
    const result = selector.selectAction('protoforge-core', health, {} as any, 'incident-1');
    expect(result.selected).toBeNull();
    expect(result.reason).toContain('HEALTHY');
  });

  it('selects recovery action when component is UNAVAILABLE', () => {
    setComponentState('protoforge-core', 'UNAVAILABLE', [
      { check: 'port-listening', status: 'fail' },
    ]);
    const health = model.getState('protoforge-core');
    const result = selector.selectAction('protoforge-core', health, {} as any, 'incident-1');
    expect(result.selected).not.toBeNull();
    expect(result.selected!.capability).toBe('health.recover');
    expect(result.selected!.target).toBe('protoforge-core');
  });

  it('selects escalation when circuit breaker is tripped', () => {
    // Trip the circuit breaker
    budget.recordAttempt('protoforge-core', 'incident-1', false);
    budget.recordAttempt('protoforge-core', 'incident-1', false);
    budget.recordAttempt('protoforge-core', 'incident-1', false);

    setComponentState('protoforge-core', 'UNAVAILABLE');
    const health = model.getState('protoforge-core');
    const result = selector.selectAction('protoforge-core', health, {} as any, 'incident-1');
    expect(result.selected).toBeNull();
    expect(result.reason).toContain('ESCALATION_REQUIRED');
  });

  it('selects escalation when budget is exhausted', () => {
    // Exhaust the budget
    budget.recordAttempt('protoforge-core', 'incident-1', false);
    budget.recordAttempt('protoforge-core', 'incident-1', false);

    setComponentState('protoforge-core', 'UNAVAILABLE');
    const health = model.getState('protoforge-core');
    const result = selector.selectAction('protoforge-core', health, {} as any, 'incident-1');
    expect(result.selected).toBeNull();
    expect(result.reason).toContain('ESCALATION_REQUIRED');
  });

  it('selects NO_ACTION for UNKNOWN state', () => {
    setComponentState('protoforge-core', 'UNKNOWN');
    const health = model.getState('protoforge-core');
    const result = selector.selectAction('protoforge-core', health, {} as any, 'incident-1');
    expect(result.selected).toBeNull();
  });

  it('selects escalation for ESCALATION_REQUIRED state', () => {
    setComponentState('protoforge-core', 'ESCALATION_REQUIRED');
    const health = model.getState('protoforge-core');
    const result = selector.selectAction('protoforge-core', health, {} as any, 'incident-1');
    expect(result.selected).toBeNull();
    expect(result.reason).toContain('ESCALATION_REQUIRED');
  });

  it('dry-run mode does not change behavior but flags dryRun', () => {
    setComponentState('protoforge-core', 'UNAVAILABLE', [
      { check: 'port-listening', status: 'fail' },
    ]);
    const health = model.getState('protoforge-core');
    const result = selector.selectAction('protoforge-core', health, {} as any, 'incident-1', true);
    expect(result.dryRun).toBe(true);
    expect(result.selected).not.toBeNull();
  });
});
