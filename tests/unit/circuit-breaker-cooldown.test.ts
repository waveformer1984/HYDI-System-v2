/**
 * Regression test for the permanent-deadlock bug found live 2026-09-27:
 * isCircuitBreakerTripped() returned the flag without honoring the
 * cooldown, so once a breaker tripped and was persisted durable, it
 * stayed tripped forever — ActionSelector denied policy before ever
 * reaching canRecover(), which is the only path that resets it.
 * protoforge-core sat tripped for 4 days while the watchdog escalated
 * ~9,624 times.
 */
import { RecoveryBudgetManager } from '../../lib/operational/RecoveryBudget';

const noopStateModel = {
  logEvent: () => undefined,
} as any;

describe('circuit breaker cooldown release', () => {
  test('isCircuitBreakerTripped releases after cooldownMs elapses', () => {
    let t = 1_000_000;
    const mgr = new RecoveryBudgetManager(
      noopStateModel,
      { circuitBreakerThreshold: 2, circuitBreakerCooldownMs: 60_000 },
      undefined,
      () => t,
    );
    // trip the breaker: threshold=2 consecutive failures
    mgr.recordAttempt('svc', 'inc1', false);
    mgr.recordAttempt('svc', 'inc1', false);
    expect(mgr.isCircuitBreakerTripped('svc')).toBe(true);

    // within cooldown — still tripped
    t += 30_000;
    expect(mgr.isCircuitBreakerTripped('svc')).toBe(true);

    // after cooldown — released, allowed again
    t += 31_000;
    expect(mgr.isCircuitBreakerTripped('svc')).toBe(false);
    const check = mgr.canRecover('svc', 'inc2');
    expect(check.allowed).toBe(true);
  });

  test('released breaker does not re-trip on read alone', () => {
    let t = 1_000_000;
    const mgr = new RecoveryBudgetManager(
      noopStateModel,
      { circuitBreakerThreshold: 2, circuitBreakerCooldownMs: 60_000 },
      undefined,
      () => t,
    );
    mgr.recordAttempt('svc', 'inc1', false);
    mgr.recordAttempt('svc', 'inc1', false);
    expect(mgr.isCircuitBreakerTripped('svc')).toBe(true);
    t += 61_000;
    // read releases — next read also sees released, not re-tripped
    expect(mgr.isCircuitBreakerTripped('svc')).toBe(false);
    expect(mgr.isCircuitBreakerTripped('svc')).toBe(false);
  });
});
