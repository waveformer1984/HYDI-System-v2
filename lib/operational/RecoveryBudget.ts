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
import type { DurableBudgetStore } from './DurableBudgetStore';

const DEFAULT_BUDGET: BudgetConfig = {
  maxRecoveryActionsPerIncident: 5,
  maxRetriesPerComponent: 3,
  maxConcurrentRecoveries: 1,
  maxAffectedComponents: 10,
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMs: 300000, // 5 minutes
  retryEpisodeMs: 3600000, // 1 hour — a quiet failure episode lapses and the
  // retry budget renews. Without this the durable retry count was a lifetime
  // budget: exhausted (e.g. 4/3) meant permanently refused, because the only
  // reset path was a successful recovery that the count itself was blocking.
  // Measured live 2026-09-20: protoforge-core could not recover after last
  // night's storm burned its budget — refuse → no attempt → no reset → deadlock.
};

export class RecoveryBudgetManager {
  private config: BudgetConfig;
  private stateModel: SystemStateModel;
  private breakers = new Map<string, CircuitBreakerState>();
  private incidentActionCounts = new Map<string, number>(); // incidentId → count
  private componentRetryCounts = new Map<string, number>(); // component → count (per episode)
  private componentLastAttemptAt = new Map<string, number>(); // component → ms epoch of last attempt
  private durableStore: DurableBudgetStore | null;
  private now: () => number;

  constructor(stateModel: SystemStateModel, config?: Partial<BudgetConfig>, durableStore?: DurableBudgetStore, now?: () => number) {
    this.stateModel = stateModel;
    this.config = { ...DEFAULT_BUDGET, ...config };
    this.durableStore = durableStore ?? null;
    this.now = now ?? Date.now;

    // Phase 7 Fix: Restore circuit breaker state from durable storage on construction.
    // This prevents a watchdog restart from silently resetting the budget.
    if (this.durableStore) {
      const allStates = this.durableStore.getAllStates();
      for (const durable of allStates) {
        // Restore circuit breaker state
        if (durable.circuitBreakerTripped) {
          this.breakers.set(durable.component, {
            component: durable.component,
            consecutiveFailures: durable.consecutiveFailures,
            tripped: true,
            trippedAt: durable.circuitBreakerTrippedAt,
            lastFailureAt: durable.lastFailureAt,
            totalAttempts: durable.totalAttempts,
            totalSuccesses: durable.totalSuccesses,
          });
        }
        // Restore retry counts — but only while the failure episode is still
        // live. lastFailureAt older than retryEpisodeMs means the episode is
        // over (quiet for a full window — the escalation was acted on or the
        // fault cleared), so the budget renews via an audited expiry rather
        // than deadlock. A positive count with NO timestamp cannot be proven
        // expired and is restored as-is (fail closed).
        if (durable.retryCount > 0) {
          const lastAt = durable.lastFailureAt ? new Date(durable.lastFailureAt).getTime() : NaN;
          if (Number.isFinite(lastAt)) {
            if (this.now() - lastAt < this.config.retryEpisodeMs) {
              this.componentRetryCounts.set(durable.component, durable.retryCount);
              this.componentLastAttemptAt.set(durable.component, lastAt);
            } else {
              this.expireEpisode(durable.component, durable.retryCount, durable.lastFailureAt);
            }
          } else {
            this.componentRetryCounts.set(durable.component, durable.retryCount);
          }
        }
      }
    }
  }

  /**
   * Expire a spent retry episode: the component has been quiet for a full
   * retryEpisodeMs window, so the failure episode is over and the budget
   * renews. This is an audited transition — a durable reset record is
   * appended (the JSONL history is preserved, not rewritten) and a
   * budget_episode_expired event records the prior count and anchor time.
   */
  private expireEpisode(component: string, previousCount: number, lastAttemptAt: string | null): void {
    this.componentRetryCounts.delete(component);
    this.componentLastAttemptAt.delete(component);
    if (this.durableStore) {
      this.durableStore.updateState(component, { retryCount: 0 });
    }
    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: new Date(this.now()).toISOString(),
      type: 'budget_episode_expired',
      component,
      action: 'budget_window',
      actionResult: 'success',
      detail: {
        previousRetryCount: previousCount,
        lastAttemptAt,
        expiredAt: new Date(this.now()).toISOString(),
        retryEpisodeMs: this.config.retryEpisodeMs,
        reason: 'retry episode lapsed — budget renewed after quiet window',
      },
    });
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
    // Phase 7 Fix: Check durable store for exhausted incidents first.
    // This prevents a watchdog restart from giving a fresh budget to an
    // incident that was already escalated.
    if (this.durableStore && this.durableStore.isIncidentExhausted(component, incidentId)) {
      return {
        allowed: false,
        reason: `incident ${incidentId} was previously exhausted for ${component} — durable budget prevents re-entry`,
      };
    }

    // Check circuit breaker
    const breaker = this.breakers.get(component);
    if (breaker?.tripped) {
      const now = this.now();
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

    // Check per-component retry budget — but first let a lapsed episode
    // expire. This is the same transition the constructor applies at restore;
    // here it covers long-running processes whose episode lapses mid-run.
    const liveRetries = this.componentRetryCounts.get(component) ?? 0;
    if (liveRetries > 0) {
      const lastAt = this.componentLastAttemptAt.get(component);
      if (lastAt !== undefined && this.now() - lastAt >= this.config.retryEpisodeMs) {
        this.expireEpisode(component, liveRetries, new Date(lastAt).toISOString());
      }
    }
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
    // Increment counters — and stamp the attempt time. The episode window is
    // measured from the last attempt, so a retried-then-quiet component still
    // expires; a continuously flapping one never lapses.
    const componentRetries = this.componentRetryCounts.get(component) ?? 0;
    this.componentRetryCounts.set(component, componentRetries + 1);
    this.componentLastAttemptAt.set(component, this.now());

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
      breaker.lastFailureAt = new Date(this.now()).toISOString();

      // Trip the circuit breaker if threshold reached
      if (breaker.consecutiveFailures >= this.config.circuitBreakerThreshold) {
        breaker.tripped = true;
        breaker.trippedAt = new Date(this.now()).toISOString();

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

    // Phase 7 Fix: Persist to durable store so budget survives watchdog restarts
    if (this.durableStore) {
      this.durableStore.updateState(component, {
        retryCount: this.componentRetryCounts.get(component) ?? 0,
        totalAttempts: breaker.totalAttempts,
        totalSuccesses: breaker.totalSuccesses,
        consecutiveFailures: breaker.consecutiveFailures,
        circuitBreakerTripped: breaker.tripped,
        circuitBreakerTrippedAt: breaker.trippedAt,
        lastFailureAt: breaker.lastFailureAt,
      });
    }
  }

  /**
   * Phase 7 Fix: Mark an incident as exhausted (budget used up).
   * This persists to durable storage so a watchdog restart doesn't
   * give a fresh budget to an exhausted incident.
   */
  markIncidentExhausted(component: string, incidentId: string): void {
    if (this.durableStore) {
      this.durableStore.markIncidentExhausted(component, incidentId);
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
   *
   * Must honor the cooldown, not just the flag: callers that read this
   * accessor BEFORE canRecover() (ActionSelector) would otherwise keep a
   * breaker tripped forever — canRecover() is the only path that resets
   * it, and it is never reached when this says "still tripped". The
   * reset is the same audited transition canRecover() applies.
   */
  isCircuitBreakerTripped(component: string): boolean {
    const breaker = this.breakers.get(component);
    if (!breaker?.tripped) return false;
    const trippedAt = breaker.trippedAt ? new Date(breaker.trippedAt).getTime() : 0;
    if (this.now() - trippedAt < this.config.circuitBreakerCooldownMs) {
      return true;
    }
    // Cooldown lapsed — release the breaker, in memory and durable.
    breaker.tripped = false;
    breaker.trippedAt = null;
    breaker.consecutiveFailures = 0;
    if (this.durableStore) {
      this.durableStore.updateState(component, {
        circuitBreakerTripped: false,
        circuitBreakerTrippedAt: null,
        consecutiveFailures: 0,
      });
    }
    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: new Date(this.now()).toISOString(),
      type: 'circuit_breaker_released',
      component,
      action: 'circuit_breaker',
      actionResult: 'success',
      detail: { cooldownMs: this.config.circuitBreakerCooldownMs, reason: 'cooldown lapsed — retry permitted' },
    });
    return false;
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
    this.componentLastAttemptAt.delete(component);
    const breaker = this.breakers.get(component);
    if (breaker) {
      breaker.consecutiveFailures = 0;
    }
    // Phase 7 Fix: Persist the reset to durable storage
    if (this.durableStore) {
      this.durableStore.resetRetries(component);
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
