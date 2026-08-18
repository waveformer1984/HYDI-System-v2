/**
 * HYDI Autonomy Policy Model
 *
 * Phase 4 — Defines what Heidi is allowed to do automatically.
 *
 * Every capability has a policy with:
 *   - target (which component)
 *   - conditions (when it's allowed)
 *   - authorization (autonomous / policy / human / prohibited)
 *   - risk level
 *   - max attempts and cooldown
 *   - required evidence
 *   - escalation action
 *
 * The policy model is deterministic. The LLM may propose hypotheses,
 * but the policy engine decides what is actually permitted.
 *
 * Principle: identity decides permission, not reality.
 * Principle: confidence ≠ authorization.
 * Principle: the safest autonomous action is frequently doing nothing.
 */

import type {
  AutonomyPolicy,
  Capability,
  ComponentState,
  ComponentHealth,
  PolicyCondition,
  PolicyEvaluationResult,
  RiskLevel,
  AuthorizationMode,
  DependencyGraph,
} from './types';
import { riskClassifier } from './RiskClassifier';

/**
 * Default policy rules. These are derived from the Phase 3 capability model
 * and the Phase 4 risk classification. They can be extended or overridden
 * via configuration in the future.
 */
const DEFAULT_POLICIES: AutonomyPolicy[] = [
  // --- OBSERVE (R0, autonomous) ---
  {
    id: 'policy.observe.health',
    capability: 'health.read',
    target: '*',
    risk: 'R0',
    authorization: 'autonomous',
    allowedWhen: [],
    maxAttempts: 1,
    cooldownMs: 0,
    requiredEvidence: [],
    escalationAction: 'none — read-only',
    description: 'Read health state of any component at any time',
  },
  {
    id: 'policy.observe.diagnostic',
    capability: 'diagnostic.snapshot',
    target: '*',
    risk: 'R0',
    authorization: 'autonomous',
    allowedWhen: [],
    maxAttempts: 1,
    cooldownMs: 0,
    requiredEvidence: [],
    escalationAction: 'none — read-only',
    description: 'Produce diagnostic snapshots at any time',
  },
  {
    id: 'policy.observe.probe',
    capability: 'runtime.probe',
    target: '*',
    risk: 'R0',
    authorization: 'autonomous',
    allowedWhen: [],
    maxAttempts: 1,
    cooldownMs: 0,
    requiredEvidence: [],
    escalationAction: 'none — read-only',
    description: 'Execute functional probes at any time',
  },
  {
    id: 'policy.observe.config_validate',
    capability: 'configuration.validate',
    target: '*',
    risk: 'R0',
    authorization: 'autonomous',
    allowedWhen: [],
    maxAttempts: 1,
    cooldownMs: 0,
    requiredEvidence: [],
    escalationAction: 'none — read-only',
    description: 'Validate configuration without changes',
  },

  // --- RECOVER / RESTART (R1, autonomous within bounds) ---
  {
    id: 'policy.recover.protoforge-core',
    capability: 'health.recover',
    target: 'protoforge-core',
    risk: 'R1',
    authorization: 'autonomous',
    allowedWhen: [
      { field: 'state', operator: 'in', value: ['UNAVAILABLE', 'FAILED'] },
      { field: 'process_identity', operator: 'nin', value: ['wrong_process'] },
    ],
    maxAttempts: 2,
    cooldownMs: 30000,
    requiredEvidence: ['port-listening', 'process-identity', 'health-endpoint'],
    escalationAction: 'human_review',
    description: 'Restart protoforge-core when unavailable, max 2 attempts',
  },
  {
    id: 'policy.recover.heidi-web',
    capability: 'health.recover',
    target: 'heidi-web',
    risk: 'R1',
    authorization: 'autonomous',
    allowedWhen: [
      { field: 'state', operator: 'in', value: ['UNAVAILABLE', 'FAILED'] },
      { field: 'dependency_state', operator: 'neq', value: 'UNAVAILABLE' },
    ],
    maxAttempts: 2,
    cooldownMs: 30000,
    requiredEvidence: ['port-listening', 'process-identity', 'health-endpoint'],
    escalationAction: 'human_review',
    description: 'Restart heidi-web when unavailable (dependencies must be healthy), max 2 attempts',
  },
  {
    id: 'policy.recover.heidi-mobile-chat',
    capability: 'health.recover',
    target: 'heidi-mobile-chat',
    risk: 'R1',
    authorization: 'autonomous',
    allowedWhen: [
      { field: 'state', operator: 'in', value: ['UNAVAILABLE', 'FAILED'] },
    ],
    maxAttempts: 2,
    cooldownMs: 30000,
    requiredEvidence: ['port-listening', 'health-endpoint'],
    escalationAction: 'human_review',
    description: 'Restart heidi-mobile-chat when unavailable, max 2 attempts',
  },
  {
    id: 'policy.recover.database',
    capability: 'database.recover',
    target: 'database',
    risk: 'R2',
    authorization: 'policy_authorized',
    allowedWhen: [
      { field: 'state', operator: 'in', value: ['UNAVAILABLE', 'DEGRADED'] },
    ],
    maxAttempts: 1,
    cooldownMs: 60000,
    requiredEvidence: ['rest-reachable'],
    escalationAction: 'human_review — database recovery is wait-only, no destructive actions',
    description: 'Wait for database recovery (no destructive actions), max 1 attempt',
  },

  // --- ESCALATE (always allowed — escalation is a safety mechanism) ---
  {
    id: 'policy.escalate.any',
    capability: 'health.recover',
    target: '*',
    risk: 'R0',
    authorization: 'autonomous',
    allowedWhen: [
      { field: 'state', operator: 'eq', value: 'ESCALATION_REQUIRED' },
    ],
    maxAttempts: 1,
    cooldownMs: 0,
    requiredEvidence: [],
    escalationAction: 'human_review',
    description: 'Escalate to human operator when recovery is exhausted',
  },
];

export class AutonomyPolicyModel {
  private policies: AutonomyPolicy[];
  private overrides: Map<string, AutonomyPolicy[]> = new Map();

  constructor() {
    this.policies = [...DEFAULT_POLICIES];
  }

  /**
   * Get all policy rules.
   */
  getAllPolicies(): AutonomyPolicy[] {
    return [...this.policies];
  }

  /**
   * Find policies that match a capability + target.
   * Target '*' matches any target. Specific target matches before wildcard.
   */
  findPolicies(capability: Capability, target: string): AutonomyPolicy[] {
    const specific = this.policies.filter(
      (p) => p.capability === capability && p.target === target,
    );
    const wildcard = this.policies.filter(
      (p) => p.capability === capability && p.target === '*',
    );
    // Specific policies take precedence over wildcard
    return specific.length > 0 ? specific : wildcard;
  }

  /**
   * Evaluate a policy against observed component state.
   * Returns whether the action is allowed and why.
   */
  evaluate(
    policy: AutonomyPolicy,
    componentHealth: ComponentHealth,
    graph?: DependencyGraph,
    circuitBreakerTripped?: boolean,
  ): PolicyEvaluationResult {
    const conditionsMet: PolicyCondition[] = [];
    const conditionsFailed: PolicyCondition[] = [];

    for (const condition of policy.allowedWhen) {
      const met = this.evaluateCondition(condition, componentHealth, graph, circuitBreakerTripped);
      if (met) {
        conditionsMet.push(condition);
      } else {
        conditionsFailed.push(condition);
      }
    }

    // If circuit breaker is tripped, deny regardless of other conditions
    if (circuitBreakerTripped) {
      return {
        policy,
        allowed: false,
        reason: `circuit breaker tripped for ${componentHealth.component} — escalation required`,
        conditionsMet,
        conditionsFailed,
        risk: policy.risk,
        authorization: 'human_required',
      };
    }

    // If risk is prohibited, deny regardless
    if (riskClassifier.isProhibited(policy.risk)) {
      return {
        policy,
        allowed: false,
        reason: `risk level ${policy.risk} is prohibited for autonomous Heidi`,
        conditionsMet,
        conditionsFailed,
        risk: policy.risk,
        authorization: 'prohibited',
      };
    }

    // If risk requires human, deny for autonomous
    if (riskClassifier.requiresHuman(policy.risk)) {
      return {
        policy,
        allowed: false,
        reason: `risk level ${policy.risk} requires human authorization`,
        conditionsMet,
        conditionsFailed,
        risk: policy.risk,
        authorization: 'human_required',
      };
    }

    // All conditions must be met
    const allConditionsMet = conditionsFailed.length === 0;
    const allowed = allConditionsMet;

    return {
      policy,
      allowed,
      reason: allowed
        ? `all ${conditionsMet.length} condition(s) met`
        : `${conditionsFailed.length} condition(s) failed: ${conditionsFailed.map((c) => `${c.field} ${c.operator} ${c.value}`).join(', ')}`,
      conditionsMet,
      conditionsFailed,
      risk: policy.risk,
      authorization: policy.authorization,
    };
  }

  /**
   * Evaluate a single policy condition against observed state.
   */
  private evaluateCondition(
    condition: PolicyCondition,
    health: ComponentHealth,
    graph?: DependencyGraph,
    circuitBreakerTripped?: boolean,
  ): boolean {
    let actualValue: string | string[] | number | boolean;

    switch (condition.field) {
      case 'state':
        actualValue = health.state;
        break;
      case 'process_identity': {
        const evidence = health.evidence.find((e) => e.check === 'process-identity');
        // If no process-identity evidence, treat as 'absent' (not 'wrong_process')
        // — 'wrong_process' is only when we explicitly checked and it failed
        if (!evidence) {
          actualValue = 'absent';
        } else {
          actualValue = evidence.status === 'pass' ? 'correct' : 'wrong_process';
        }
        break;
      }
      case 'dependency_state': {
        // Check if any dependency is UNAVAILABLE
        const depStates = health.dependencies ?? {};
        const anyUnavailable = Object.values(depStates).some(
          (s) => s === 'UNAVAILABLE' || s === 'FAILED',
        );
        actualValue = anyUnavailable ? 'UNAVAILABLE' : 'HEALTHY';
        break;
      }
      case 'port_listening': {
        const evidence = health.evidence.find((e) => e.check === 'port-listening');
        actualValue = evidence?.status === 'pass' ? 'listening' : 'not_listening';
        break;
      }
      case 'health_endpoint': {
        const evidence = health.evidence.find((e) => e.check === 'health-endpoint');
        actualValue = evidence?.status === 'pass' ? 'ok' : 'fail';
        break;
      }
      case 'recovery_count': {
        // This would be provided by the recovery budget tracker
        // For now, use the detail field if present
        actualValue = (health as ComponentHealth & { recoveryCount?: number }).recoveryCount ?? 0;
        break;
      }
      case 'circuit_breaker':
        actualValue = circuitBreakerTripped ?? false;
        break;
      default:
        return false;
    }

    return this.compareValues(actualValue, condition.operator, condition.value);
  }

  /**
   * Compare values using the policy DSL operators.
   */
  private compareValues(
    actual: string | string[] | number | boolean,
    operator: PolicyCondition['operator'],
    expected: string | string[] | number,
  ): boolean {
    switch (operator) {
      case 'eq':
        return actual === expected;
      case 'neq':
        return actual !== expected;
      case 'in':
        return Array.isArray(expected) && expected.includes(String(actual));
      case 'nin':
        return Array.isArray(expected) && !expected.includes(String(actual));
      case 'lt':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      case 'gt':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      case 'lte':
        return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
      case 'gte':
        return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
      default:
        return false;
    }
  }

  /**
   * Check if a capability+target combination has any policy at all.
   * Unknown capabilities are denied (no scope creep).
   */
  hasPolicy(capability: Capability, target: string): boolean {
    return this.findPolicies(capability, target).length > 0;
  }

  /**
   * Add a custom policy rule (for testing or future configuration).
   */
  addPolicy(policy: AutonomyPolicy): void {
    this.policies.push(policy);
  }
}

/**
 * Singleton policy model instance.
 */
export const autonomyPolicyModel = new AutonomyPolicyModel();
