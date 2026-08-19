/**
 * HEIDI Recovery Strategy Model
 *
 * Phase 5 — Moves HEIDI toward explicit recovery strategies rather than
 * ad hoc conditionals. Each strategy defines:
 *   - strategyId
 *   - targetType (process, container, service, dependency)
 *   - preconditions
 *   - allowedActions
 *   - risk
 *   - timeout
 *   - rollbackBehavior
 *   - verification
 *   - successCriteria
 *   - failureCriteria
 *   - escalationPolicy
 *
 * Strategies are selected through the existing decision/policy pipeline
 * (ActionSelector → AutonomyPolicyModel → CapabilityAuthorizer).
 * This is NOT a second decision engine — it enriches the existing one.
 */

import type { RiskLevel, RecoveryPolicyId } from './types';

export interface RecoveryStrategy {
  strategyId: string;
  targetType: 'process' | 'container' | 'service' | 'dependency';
  preconditions: string[];
  allowedActions: RecoveryPolicyId[];
  risk: RiskLevel;
  timeoutMs: number;
  rollbackBehavior: 'none' | 'restart_original' | 'escalate';
  verification: string;
  successCriteria: string;
  failureCriteria: string;
  escalationPolicy: string;
}

const DEFAULT_STRATEGIES: RecoveryStrategy[] = [
  {
    strategyId: 'strategy.process-restart',
    targetType: 'process',
    preconditions: ['component is UNAVAILABLE or FAILED', 'port not listening or process not found'],
    allowedActions: ['restart_process'],
    risk: 'R1',
    timeoutMs: 120000,
    rollbackBehavior: 'none',
    verification: 'process alive + endpoint healthy + expected response body',
    successCriteria: 'component state is HEALTHY with port-listening + process-identity + health-endpoint evidence',
    failureCriteria: 'component state is not HEALTHY after maxAttempts',
    escalationPolicy: 'escalate to human operator with evidence and attempted actions',
  },
  {
    strategyId: 'strategy.container-restart',
    targetType: 'container',
    preconditions: ['container is UNAVAILABLE or FAILED', 'docker daemon is available'],
    allowedActions: ['restart_container', 'recover_database'],
    risk: 'R2',
    timeoutMs: 30000,
    rollbackBehavior: 'none',
    verification: 'container running + service endpoint healthy + dependency functional',
    successCriteria: 'container state is running AND REST API responds through Kong gateway',
    failureCriteria: 'container not running OR service-level verification fails',
    escalationPolicy: 'escalate to human operator — container restart failed, manual intervention required',
  },
  {
    strategyId: 'strategy.ollama-restart',
    targetType: 'service',
    preconditions: ['ollama is UNAVAILABLE or DEGRADED', '/api/tags not responding'],
    allowedActions: ['restart_ollama'],
    risk: 'R2',
    timeoutMs: 15000,
    rollbackBehavior: 'none',
    verification: 'Ollama /api/tags responds with model list',
    successCriteria: 'ollama /api/tags returns 200 with at least one model',
    failureCriteria: 'ollama /api/tags does not respond or returns empty model list',
    escalationPolicy: 'escalate to human operator — AI features degraded',
  },
  {
    strategyId: 'strategy.dependency-recovery',
    targetType: 'dependency',
    preconditions: ['component is BLOCKED', 'one or more dependencies are UNAVAILABLE or FAILED'],
    allowedActions: ['restart_process', 'restart_container', 'recover_database', 'wait_for_dependency'],
    risk: 'R1',
    timeoutMs: 180000,
    rollbackBehavior: 'none',
    verification: 'dependency healthy + dependent service healthy',
    successCriteria: 'dependency is HEALTHY AND dependent component transitions from BLOCKED to HEALTHY',
    failureCriteria: 'dependency remains UNAVAILABLE after maxAttempts',
    escalationPolicy: 'escalate to human operator — dependency recovery failed, cascading impact possible',
  },
  {
    strategyId: 'strategy.escalation',
    targetType: 'process',
    preconditions: ['recovery budget exhausted OR circuit breaker tripped OR action denied by policy'],
    allowedActions: ['escalate'],
    risk: 'R0',
    timeoutMs: 1000,
    rollbackBehavior: 'none',
    verification: 'escalation package created with evidence and recommended action',
    successCriteria: 'escalation package is recorded in PDR with complete evidence chain',
    failureCriteria: 'escalation package could not be created',
    escalationPolicy: 'human review required — no further autonomous action',
  },
];

export class RecoveryStrategyModel {
  private strategies: Map<string, RecoveryStrategy> = new Map();

  constructor(strategies: RecoveryStrategy[] = DEFAULT_STRATEGIES) {
    for (const s of strategies) {
      this.strategies.set(s.strategyId, s);
    }
  }

  /**
   * Select a strategy for a component based on its type and state.
   * This enriches the ActionSelector's decision — it does not replace it.
   */
  selectStrategy(
    componentType: 'process' | 'container' | 'service' | 'dependency',
    state: string,
  ): RecoveryStrategy | null {
    // If state is ESCALATION_REQUIRED, use escalation strategy
    if (state === 'ESCALATION_REQUIRED' || state === 'FAILED') {
      return this.strategies.get('strategy.escalation') ?? null;
    }

    // If state is BLOCKED, use dependency recovery
    if (state === 'BLOCKED') {
      return this.strategies.get('strategy.dependency-recovery') ?? null;
    }

    // Otherwise, match by target type
    const candidates = [...this.strategies.values()]
      .filter((s) => s.targetType === componentType && s.strategyId !== 'strategy.escalation');

    return candidates[0] ?? null;
  }

  get(strategyId: string): RecoveryStrategy | null {
    return this.strategies.get(strategyId) ?? null;
  }

  getAll(): RecoveryStrategy[] {
    return [...this.strategies.values()];
  }

  /**
   * Get the verification criteria for a strategy.
   * Used by RecoveryEngine to verify postconditions.
   */
  getVerificationCriteria(strategyId: string): string | null {
    return this.strategies.get(strategyId)?.verification ?? null;
  }

  /**
   * Get the success criteria for a strategy.
   */
  getSuccessCriteria(strategyId: string): string | null {
    return this.strategies.get(strategyId)?.successCriteria ?? null;
  }
}

export const recoveryStrategyModel = new RecoveryStrategyModel();
