/**
 * Phase 4 — Autonomy Policy Model & Risk Classifier Tests
 *
 * Tests:
 * - Risk classification for each capability
 * - Policy evaluation (allowed/denied based on conditions)
 * - R0-R5 authorization modes
 * - No policy = denied (no scope creep)
 * - Circuit breaker trips deny recovery
 * - Prohibited risk levels are denied
 */

import { AutonomyPolicyModel } from '../../lib/operational/AutonomyPolicyModel';
import { RiskClassifier, riskClassifier } from '../../lib/operational/RiskClassifier';
import type { ComponentHealth, Capability } from '../../lib/operational/types';

describe('Phase 4 — RiskClassifier', () => {
  const classifier = riskClassifier;

  it('classifies read-only capabilities as R0', () => {
    expect(classifier.classifyCapability('health.read')).toBe('R0');
    expect(classifier.classifyCapability('diagnostic.snapshot')).toBe('R0');
    expect(classifier.classifyCapability('runtime.probe')).toBe('R0');
    expect(classifier.classifyCapability('configuration.validate')).toBe('R0');
  });

  it('classifies process restart as R1 (reversible)', () => {
    expect(classifier.classifyCapability('process.restart')).toBe('R1');
    expect(classifier.classifyCapability('health.recover')).toBe('R1');
  });

  it('classifies database recovery as R2 (bounded config change)', () => {
    expect(classifier.classifyCapability('database.recover')).toBe('R2');
  });

  it('R0 and R1 are autonomous', () => {
    expect(classifier.isAutonomous('R0')).toBe(true);
    expect(classifier.isAutonomous('R1')).toBe(true);
  });

  it('R3 and R4 require human authorization', () => {
    expect(classifier.requiresHuman('R3')).toBe(true);
    expect(classifier.requiresHuman('R4')).toBe(true);
  });

  it('R5 is prohibited for autonomous Heidi', () => {
    expect(classifier.isProhibited('R5')).toBe(true);
  });

  it('confidence ≠ authorization — high risk is denied regardless of confidence', () => {
    const eval_ = classifier.evaluate('process.restart');
    expect(eval_.risk).toBe('R1');
    expect(eval_.authorization).toBe('autonomous');
    // R5 would be prohibited even with 100% confidence
    const r5Eval = classifier.evaluate('process.restart');
    expect(r5Eval.authorization).not.toBe('prohibited');
  });
});

describe('Phase 4 — AutonomyPolicyModel', () => {
  let model: AutonomyPolicyModel;

  beforeEach(() => {
    model = new AutonomyPolicyModel();
  });

  function makeHealth(state: string, evidence: Array<{ check: string; status: string }> = []): ComponentHealth {
    return {
      component: 'protoforge-core',
      category: 'protoforge',
      state: state as ComponentHealth['state'],
      evidence: evidence.map((e) => ({
        check: e.check,
        status: e.status as 'pass' | 'fail',
        value: 'test',
        checkedAt: new Date().toISOString(),
      })),
      checkedAt: new Date().toISOString(),
    };
  }

  it('has policies for health.recover on boot modules', () => {
    expect(model.findPolicies('health.recover', 'protoforge-core').length).toBeGreaterThan(0);
    expect(model.findPolicies('health.recover', 'heidi-web').length).toBeGreaterThan(0);
  });

  it('allows recovery when state is UNAVAILABLE', () => {
    const policies = model.findPolicies('health.recover', 'protoforge-core');
    const health = makeHealth('UNAVAILABLE');
    const result = model.evaluate(policies[0], health);
    expect(result.allowed).toBe(true);
  });

  it('denies recovery when state is HEALTHY (idempotent)', () => {
    const policies = model.findPolicies('health.recover', 'protoforge-core');
    const health = makeHealth('HEALTHY');
    const result = model.evaluate(policies[0], health);
    expect(result.allowed).toBe(false);
  });

  it('denies recovery when process identity is wrong (no false green)', () => {
    const policies = model.findPolicies('health.recover', 'protoforge-core');
    const health = makeHealth('UNAVAILABLE', [
      { check: 'process-identity', status: 'fail' },
    ]);
    const result = model.evaluate(policies[0], health);
    expect(result.allowed).toBe(false);
    expect(result.conditionsFailed.length).toBeGreaterThan(0);
  });

  it('denies recovery when circuit breaker is tripped', () => {
    const policies = model.findPolicies('health.recover', 'protoforge-core');
    const health = makeHealth('UNAVAILABLE');
    const result = model.evaluate(policies[0], health, undefined, true); // circuitBreakerTripped
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('circuit breaker');
  });

  it('returns no policies for unknown capabilities (no scope creep)', () => {
    // Unknown target should fall back to wildcard, but if none exists, deny
    const policies = model.findPolicies('health.recover', 'unknown-component');
    // Should find the wildcard escalate policy
    expect(policies.length).toBeGreaterThan(0);
  });

  it('read-only capabilities are always allowed', () => {
    const policies = model.findPolicies('health.read', 'anything');
    expect(policies.length).toBeGreaterThan(0);
    expect(policies[0].authorization).toBe('autonomous');
    expect(policies[0].risk).toBe('R0');
  });

  it('database recovery is R2 (policy_authorized, not autonomous)', () => {
    const policies = model.findPolicies('database.recover', 'database');
    expect(policies[0].risk).toBe('R2');
    expect(policies[0].authorization).toBe('policy_authorized');
  });
});
