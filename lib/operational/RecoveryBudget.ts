/**
 * HYDI Recovery Budget & Circuit Breaker
 *
 * Phase 4 — Prevents infinite recovery loops and enforces global limits.
 *
 * Features:
 *   - Per-component retry budget (max attempts per incident)
 *   - Per-incident action budget (max total recovery actions)
 *   - Circuit breaker (trips after N consecutive failures, stays tripped for cooldown)
 *   - Repeated-failure detection
 *   - Escalation when budget exhausted
 *
 * Never: failure → restart → failure → restart → infinite loop
 * Always: failure → attempt 1 → failure → cooldown → attempt 2 → failure → ESCALATE
 */

import { randomUUID } from 'crypto';
import type { RecoveryBudget as BudgetConfig, CircuitBreakerState } from './types';
import type { SystemStateModel } from './SystemStateModel';

const DEFAULT_BUDGET: BudgetConfig = {
  maxRecoveryActionsPerIncident: 5,
  maxRetriesPerComponent: 3,
  maxConcurrentRecoveries: 1,
  maxAffectedComponents: 10,
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMs: 300000, // 5 minutes
};

export class RecoveryBudgetManager {
  private config: BudgetConfig;
  private stateModel: SystemStateModel;
  private breakers = new Map<string, CircuitBreakerState>();
  private incidentActionCounts = new Map<string, number>(); // incidentId → count
  private componentRetryCounts = new Map<string, number>(); // component → count (per incident)

  constructor(stateModel: SystemStateModel, config?: Partial<BudgetConfig>) {
    this.stateModel = stateModel;
    this.config = { ...DEFAULT_BUDGET, ...config };
  }

  /**
   * Get the budget configuration.
   */
  getConfig(): BudgetConfig {
    return { ...this.config };
  }

  /**
   * Check if a recovery action is within budget.
   */
  canRecover(component: string, incidentId: string): { allowed: boolean; reason: string } {
    // Check circuit breaker
    const breaker = this.breakers.get(component);
    if (breaker?.tripped) {
      const now = Date.now();
      const trippedAt = breaker.trippedAt ? new Date(breaker.trippedAt).getTime() : 0;
      if (now - trippedAt < this.config.circuitBreakerCooldownMs) {
        return {
          allowed: false,
          reason: `circuit breaker tripped for ${component} — cooldown remaining ${Math.ceil((this.config.circuitBreakerCooldownMs - (now - trippedAt)) / 1000)}s`,
        };
      }
      // Cooldown expired — reset breaker
      breaker.tripped = false;
      breaker.trippedAt = null;
      breaker.consecutiveFailures = 0;
    }

    // Check per-component retry budget
    const componentRetries = this.componentRetryCounts.get(component) ?? 0;
    if (componentRetries >= this.config.maxRetriesPerComponent) {
      return {
        allowed: false,
        reason: `retry budget exhausted for ${component}: ${componentRetries}/${this.config.maxRetriesPerComponent}`,
      };
    }

    // Check per-incident action budget
    const incidentActions = this.incidentActionCounts.get(incidentId) ?? 0;
    if (incidentActions >= this.config.maxRecoveryActionsPerIncident) {
      return {
        allowed: false,
        reason: `incident budget exhausted: ${incidentActions}/${this.config.maxRecoveryActionsPerIncident} actions`,
      };
    }

    return { allowed: true, reason: 'within budget' };
  }

  /**
   * Record a recovery attempt result.
   */
  recordAttempt(component: string, incidentId: string, success: boolean): void {
    // Increment counters
    const componentRetries = this.componentRetryCounts.get(component) ?? 0;
    this.componentRetryCounts.set(component, componentRetries + 1);

    const incidentActions = this.incidentActionCounts.get(incidentId) ?? 0;
    this.incidentActionCounts.set(incidentId, incidentActions + 1);

    // Update circuit breaker
    let breaker = this.breakers.get(component);
    if (!breaker) {
      breaker = {
        component,
        consecutiveFailures: 0,
        tripped: false,
        trippedAt: null,
        lastFailureAt: null,
        totalAttempts: 0,
        totalSuccesses: 0,
      };
      this.breakers.set(component, breaker);
    }

    breaker.totalAttempts++;
    if (success) {
      breaker.consecutiveFailures = 0;
      breaker.totalSuccesses++;
    } else {
      breaker.consecutiveFailures++;
      breaker.lastFailureAt = new Date().toISOString();

      // Trip the circuit breaker if threshold reached
      if (breaker.consecutiveFailures >= this.config.circuitBreakerThreshold) {
        breaker.tripped = true;
        breaker.trippedAt = new Date().toISOString();

        this.stateModel.logEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'circuit_breaker_tripped',
          component,
          cause: `${breaker.consecutiveFailures} consecutive failures`,
          action: 'circuit_breaker',
          actionResult: 'denied',
          detail: {
            threshold: this.config.circuitBreakerThreshold,
            cooldownMs: this.config.circuitBreakerCooldownMs,
            totalAttempts: breaker.totalAttempts,
            totalSuccesses: breaker.totalSuccesses,
          },
        });
      }
    }
  }

  /**
   * Get the circuit breaker state for a component.
   */
  getCircuitBreaker(component: string): CircuitBreakerState | null {
    const breaker = this.breakers.get(component);
    return breaker ? { ...breaker } : null;
  }

  /**
   * Get all circuit breaker states (for diagnostics).
   */
  getAllCircuitBreakers(): CircuitBreakerState[] {
    return Array.from(this.breakers.values()).map((b) => ({ ...b }));
  }

  /**
   * Check if the circuit breaker is tripped for a component.
   */
  isCircuitBreakerTripped(component: string): boolean {
    return this.breakers.get(component)?.tripped ?? false;
  }

  /**
   * Reset the budget for a specific incident (when incident is resolved).
   */
  resetIncident(incidentId: string): void {
    this.incidentActionCounts.delete(incidentId);
    // Don't reset component retry counts — they persist across incidents
    // to prevent oscillation. They reset on successful recovery.
  }

  /**
   * Reset the retry count for a component (on successful recovery).
   */
  resetComponentRetries(component: string): void {
    this.componentRetryCounts.delete(component);
    const breaker = this.breakers.get(component);
    if (breaker) {
      breaker.consecutiveFailures = 0;
    }
  }

  /**
   * Get recovery statistics for a component.
   */
  getStats(component: string): {
    retries: number;
    maxRetries: number;
    circuitBreakerTripped: boolean;
    consecutiveFailures: number;
    totalAttempts: number;
    totalSuccesses: number;
  } {
    const breaker = this.breakers.get(component);
    return {
      retries: this.componentRetryCounts.get(component) ?? 0,
      maxRetries: this.config.maxRetriesPerComponent,
      circuitBreakerTripped: breaker?.tripped ?? false,
      consecutiveFailures: breaker?.consecutiveFailures ?? 0,
      totalAttempts: breaker?.totalAttempts ?? 0,
      totalSuccesses: breaker?.totalSuccesses ?? 0,
    };
  }
}
