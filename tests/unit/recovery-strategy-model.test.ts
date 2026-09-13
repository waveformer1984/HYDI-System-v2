/**
 * Recovery Strategy Model Tests (Phase 5)
 */

import { RecoveryStrategyModel, recoveryStrategyModel } from '../../lib/operational/RecoveryStrategyModel';

describe('Recovery Strategy Model', () => {
  it('has a strategy for process recovery', () => {
    const strategy = recoveryStrategyModel.selectStrategy('process', 'UNAVAILABLE');
    expect(strategy).not.toBeNull();
    expect(strategy!.strategyId).toBe('strategy.process-restart');
    expect(strategy!.allowedActions).toContain('restart_process');
  });

  it('has a strategy for container recovery', () => {
    const strategy = recoveryStrategyModel.selectStrategy('container', 'UNAVAILABLE');
    expect(strategy).not.toBeNull();
    expect(strategy!.strategyId).toBe('strategy.container-restart');
    expect(strategy!.allowedActions).toContain('restart_container');
  });

  it('has a strategy for dependency recovery', () => {
    const strategy = recoveryStrategyModel.selectStrategy('dependency', 'BLOCKED');
    expect(strategy).not.toBeNull();
    expect(strategy!.strategyId).toBe('strategy.dependency-recovery');
  });

  it('returns escalation strategy for FAILED state', () => {
    const strategy = recoveryStrategyModel.selectStrategy('process', 'FAILED');
    expect(strategy).not.toBeNull();
    expect(strategy!.strategyId).toBe('strategy.escalation');
  });

  it('returns escalation strategy for ESCALATION_REQUIRED state', () => {
    const strategy = recoveryStrategyModel.selectStrategy('container', 'ESCALATION_REQUIRED');
    expect(strategy).not.toBeNull();
    expect(strategy!.strategyId).toBe('strategy.escalation');
  });

  it('every strategy has verification and success criteria', () => {
    for (const strategy of recoveryStrategyModel.getAll()) {
      expect(strategy.verification).toBeDefined();
      expect(strategy.verification.length).toBeGreaterThan(10);
      expect(strategy.successCriteria).toBeDefined();
      expect(strategy.successCriteria.length).toBeGreaterThan(10);
      expect(strategy.failureCriteria).toBeDefined();
      expect(strategy.failureCriteria.length).toBeGreaterThan(10);
      expect(strategy.escalationPolicy).toBeDefined();
      expect(strategy.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('getVerificationCriteria returns the verification string', () => {
    const criteria = recoveryStrategyModel.getVerificationCriteria('strategy.process-restart');
    expect(criteria).toContain('process alive');
    expect(criteria).toContain('endpoint healthy');
  });

  it('getSuccessCriteria returns the success criteria string', () => {
    const criteria = recoveryStrategyModel.getSuccessCriteria('strategy.container-restart');
    expect(criteria).toContain('container state is running');
    expect(criteria).toContain('REST API responds');
  });
});
