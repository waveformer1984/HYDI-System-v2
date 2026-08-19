/**
 * Observation Confidence Classifier
 *
 * Phase 6: Distinguishes actual system failures from unreliable observation mechanisms.
 *
 * Core principle: observer failed ≠ target failed.
 *
 * When docker inspect fails but the REST API responds, the container is healthy
 * and the observer is broken. Recovery must NOT be authorized.
 *
 * When docker inspect says "stopped" AND the REST API is unreachable, the
 * failure is confirmed and recovery may proceed.
 */

import type {
  ObservationSource,
  ObservationAssessment,
  FailureClassification,
  ObservationConfidence,
  ObservationHysteresisState,
  ObservationHistoryEntry,
} from './types';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify an observation result using multiple sources.
 *
 * The key insight: if any independent source says the target is healthy,
 * then an observer failure on another source does NOT mean the target is down.
 */
export function classifyObservation(
  component: string,
  sources: ObservationSource[],
): ObservationAssessment {
  const now = new Date().toISOString();

  // Partition sources into ok / failing
  const okSources = sources.filter((s) => s.ok);
  const failingSources = sources.filter((s) => !s.ok);

  // Partition failing sources into observer failures vs target failures
  const observerFailures = failingSources.filter((s) => s.isObserverFailure);
  const targetFailures = failingSources.filter((s) => !s.isObserverFailure);

  // Determine classification
  let classification: FailureClassification;
  let confidence: ObservationConfidence;
  let recoveryAuthorized: boolean;
  let reason: string;

  if (okSources.length > 0 && targetFailures.length === 0) {
    // At least one source says healthy, and no source says target is actually down.
    if (observerFailures.length === 0) {
      // All sources healthy — no failure at all
      classification = 'HEALTHY';
      confidence = 'HIGH';
      recoveryAuthorized = false;
      reason = `All sources confirm target is healthy: ${okSources.map((s) => s.name).join(', ')}`;
    } else {
      // Some observers failed but target is healthy
      classification = 'OBSERVER_FAILURE';
      confidence = 'HIGH';
      recoveryAuthorized = false;
      reason = `Observer failure: ${observerFailures.map((s) => s.name).join(', ')} failed but ${okSources.map((s) => s.name).join(', ')} confirm target is healthy`;
    }
  } else if (okSources.length > 0 && targetFailures.length > 0) {
    // Conflicting evidence: some sources say healthy, others say target is down
    classification = 'OBSERVATION_UNCERTAIN';
    confidence = 'LOW';
    recoveryAuthorized = false;
    reason = `Conflicting evidence: ${okSources.map((s) => s.name).join(', ')} report healthy, ${targetFailures.map((s) => s.name).join(', ')} report target failure`;
  } else if (okSources.length === 0 && targetFailures.length > 0) {
    // All sources agree: target is actually down
    classification = 'CONFIRMED_FAILURE';
    confidence = targetFailures.length >= 2 ? 'HIGH' : 'MEDIUM';
    recoveryAuthorized = true;
    reason = `Confirmed failure: ${targetFailures.map((s) => s.name).join(', ')} all report target is down`;
  } else if (okSources.length === 0 && observerFailures.length > 0 && targetFailures.length === 0) {
    // All sources failed, but all are observer failures (no source can confirm target status)
    classification = 'OBSERVATION_UNCERTAIN';
    confidence = 'NONE';
    recoveryAuthorized = false;
    reason = `All observation sources failed (observer failures): ${observerFailures.map((s) => s.name).join(', ')}. Cannot determine target status.`;
  } else if (sources.length === 0) {
    // No sources at all
    classification = 'OBSERVATION_UNCERTAIN';
    confidence = 'NONE';
    recoveryAuthorized = false;
    reason = 'No observation sources available';
  } else {
    // Fallback: shouldn't reach here, but fail closed
    classification = 'OBSERVATION_UNCERTAIN';
    confidence = 'LOW';
    recoveryAuthorized = false;
    reason = `Unclassified observation state: ${sources.length} sources, ${okSources.length} ok, ${failingSources.length} failing`;
  }

  return {
    component,
    classification,
    confidence,
    sources,
    corroboratingEvidence: targetFailures,
    conflictingEvidence: okSources,
    recoveryAuthorized,
    reason,
    timestamp: now,
  };
}

// ---------------------------------------------------------------------------
// Hysteresis State Machine
// ---------------------------------------------------------------------------

/**
 * Default thresholds for the hysteresis state machine.
 */
export const HYSTERESIS_THRESHOLDS = {
  /** Number of consecutive failures before FAILURE_SUSPECTED → FAILURE_CONFIRMED */
  consecutiveFailuresToConfirm: 2,
  /** Number of consecutive successes to reset from any degraded state to HEALTHY */
  consecutiveSuccessesToReset: 1,
  /** Max entries to keep in observation history per component */
  maxHistoryPerComponent: 10,
};

/**
 * Track observation history per component and compute hysteresis state.
 */
export class ObservationHysteresis {
  private history: Map<string, ObservationHistoryEntry[]> = new Map();
  private states: Map<string, ObservationHysteresisState> = new Map();
  private thresholds: typeof HYSTERESIS_THRESHOLDS;

  constructor(thresholds?: Partial<typeof HYSTERESIS_THRESHOLDS>) {
    this.thresholds = { ...HYSTERESIS_THRESHOLDS, ...thresholds };
  }

  /**
   * Record an observation and update the hysteresis state.
   */
  record(component: string, assessment: ObservationAssessment): ObservationHysteresisState {
    const entry: ObservationHistoryEntry = {
      component,
      timestamp: assessment.timestamp,
      // ok = true only when the target is actually healthy
      ok: assessment.classification === 'HEALTHY' || assessment.classification === 'OBSERVER_FAILURE',
      classification: assessment.classification,
      confidence: assessment.confidence,
    };

    const hist = this.history.get(component) ?? [];
    hist.push(entry);
    if (hist.length > this.thresholds.maxHistoryPerComponent) {
      hist.shift();
    }
    this.history.set(component, hist);

    const currentState = this.states.get(component) ?? 'HEALTHY';
    const newState = this.computeState(component, hist, currentState, assessment);
    this.states.set(component, newState);
    return newState;
  }

  /**
   * Compute the new hysteresis state from history and current assessment.
   */
  private computeState(
    component: string,
    hist: ObservationHistoryEntry[],
    currentState: ObservationHysteresisState,
    assessment: ObservationAssessment,
  ): ObservationHysteresisState {
    // If recovery is in progress, don't change state
    if (currentState === 'RECOVERING') {
      return 'RECOVERING';
    }

    // If assessment authorizes recovery, check consecutive failures
    if (assessment.recoveryAuthorized) {
      const recentFailures = this.countConsecutiveFailures(hist);
      if (recentFailures >= this.thresholds.consecutiveFailuresToConfirm) {
        return 'FAILURE_CONFIRMED';
      }
      return 'FAILURE_SUSPECTED';
    }

    // All sources healthy — reset to HEALTHY
    if (assessment.classification === 'HEALTHY') {
      return 'HEALTHY';
    }

    // Observer failure — target might be fine
    if (assessment.classification === 'OBSERVER_FAILURE') {
      return 'OBSERVATION_UNCERTAIN';
    }

    // All observers failed
    if (assessment.classification === 'OBSERVATION_UNCERTAIN' && assessment.confidence === 'NONE') {
      // If we've been uncertain for too long, escalate
      const recentUncertain = this.countRecentClassifications(hist, 'OBSERVATION_UNCERTAIN');
      if (recentUncertain >= this.thresholds.consecutiveFailuresToConfirm * 2) {
        return 'OBSERVER_FAILED';
      }
      return 'OBSERVATION_UNCERTAIN';
    }

    // Conflicting evidence
    if (assessment.classification === 'OBSERVATION_UNCERTAIN') {
      return 'DEGRADED';
    }

    // Healthy
    const recentSuccesses = this.countConsecutiveSuccesses(hist);
    if (recentSuccesses >= this.thresholds.consecutiveSuccessesToReset) {
      return 'HEALTHY';
    }

    return currentState;
  }

  /**
   * Get the current hysteresis state for a component.
   */
  getState(component: string): ObservationHysteresisState {
    return this.states.get(component) ?? 'HEALTHY';
  }

  /**
   * Whether recovery is authorized for this component based on hysteresis state.
   */
  isRecoveryAuthorized(component: string): boolean {
    const state = this.getState(component);
    return state === 'FAILURE_CONFIRMED';
  }

  /**
   * Mark a component as entering recovery.
   */
  markRecovering(component: string): void {
    this.states.set(component, 'RECOVERING');
  }

  /**
   * Mark a component as recovered (or failed) after recovery completes.
   */
  markRecovered(component: string, success: boolean): void {
    this.states.set(component, success ? 'HEALTHY' : 'FAILURE_CONFIRMED');
  }

  /**
   * Get observation history for a component.
   */
  getHistory(component: string): ObservationHistoryEntry[] {
    return this.history.get(component) ?? [];
  }

  /**
   * Get all tracked component states.
   */
  getAllStates(): Array<{ component: string; state: ObservationHysteresisState }> {
    return Array.from(this.states.entries()).map(([component, state]) => ({ component, state }));
  }

  /**
   * Count consecutive failures from the end of history.
   */
  private countConsecutiveFailures(hist: ObservationHistoryEntry[]): number {
    let count = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (!hist[i].ok) count++;
      else break;
    }
    return count;
  }

  /**
   * Count consecutive successes from the end of history.
   */
  private countConsecutiveSuccesses(hist: ObservationHistoryEntry[]): number {
    let count = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].ok) count++;
      else break;
    }
    return count;
  }

  /**
   * Count recent entries with a specific classification.
   */
  private countRecentClassifications(
    hist: ObservationHistoryEntry[],
    classification: FailureClassification,
  ): number {
    const recent = hist.slice(-this.thresholds.maxHistoryPerComponent);
    return recent.filter((e) => e.classification === classification).length;
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface ObservationMetrics {
  totalObservations: number;
  observerFailures: number;
  uncertainObservations: number;
  confirmedFailures: number;
  falseRecoveriesPrevented: number;
  recoveryAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  escalations: number;
}

export class ObservationMetricsCollector {
  private metrics: ObservationMetrics = {
    totalObservations: 0,
    observerFailures: 0,
    uncertainObservations: 0,
    confirmedFailures: 0,
    falseRecoveriesPrevented: 0,
    recoveryAttempts: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    escalations: 0,
  };

  recordObservation(assessment: ObservationAssessment): void {
    this.metrics.totalObservations++;
    if (assessment.classification === 'OBSERVER_FAILURE') this.metrics.observerFailures++;
    if (assessment.classification === 'OBSERVATION_UNCERTAIN') this.metrics.uncertainObservations++;
    if (assessment.classification === 'CONFIRMED_FAILURE') this.metrics.confirmedFailures++;
    // False recovery prevented = observer failure or uncertainty where recovery was NOT authorized
    if (
      !assessment.recoveryAuthorized &&
      (assessment.classification === 'OBSERVER_FAILURE' || assessment.classification === 'OBSERVATION_UNCERTAIN')
    ) {
      this.metrics.falseRecoveriesPrevented++;
    }
    // HEALTHY observations don't count as anything special
  }

  recordRecoveryAttempt(success: boolean): void {
    this.metrics.recoveryAttempts++;
    if (success) this.metrics.successfulRecoveries++;
    else this.metrics.failedRecoveries++;
  }

  recordEscalation(): void {
    this.metrics.escalations++;
  }

  getMetrics(): ObservationMetrics {
    return { ...this.metrics };
  }

  toJSON(): string {
    return JSON.stringify(this.metrics, null, 2);
  }
}
