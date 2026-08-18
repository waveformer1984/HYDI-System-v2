/**
 * HYDI System State Model
 *
 * Single authoritative operational state model. Tracks the state of every
 * component in the system using the ComponentState enum from types.ts.
 *
 * Key principles:
 * - UNKNOWN is never collapsed into HEALTHY or FAILED
 * - State transitions are logged as OperationalEvents
 * - Every state determination carries evidence (HealthEvidence[])
 * - The model is deterministic — no LLM output determines state
 */

import { randomUUID } from 'crypto';
import type {
  ComponentCategory,
  ComponentHealth,
  ComponentState,
  HealthEvidence,
  OperationalEvent,
} from './types';

export class SystemStateModel {
  private states = new Map<string, ComponentHealth>();
  private eventLog: OperationalEvent[] = [];
  private maxEventLogSize = 1000;
  private eventForwarder: ((event: OperationalEvent) => void) | null = null;

  /**
   * Register a component for tracking. Initial state is UNKNOWN.
   */
  registerComponent(id: string, category: ComponentCategory): void {
    if (!this.states.has(id)) {
      this.states.set(id, {
        component: id,
        category,
        state: 'UNKNOWN',
        evidence: [],
        checkedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Update a component's state with evidence. Logs a state_transition event
   * if the state actually changed.
   */
  updateState(
    id: string,
    newState: ComponentState,
    evidence: HealthEvidence[],
    dependencies?: Record<string, ComponentState>,
    error?: string,
  ): ComponentHealth {
    const previous = this.states.get(id);
    const previousState = previous?.state ?? 'UNKNOWN';

    const health: ComponentHealth = {
      component: id,
      category: previous?.category ?? 'runtime',
      state: newState,
      evidence,
      dependencies,
      checkedAt: new Date().toISOString(),
      error,
    };

    this.states.set(id, health);

    if (previousState !== newState) {
      this.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'state_transition',
        component: id,
        previousState,
        newState,
        cause: error ?? undefined,
        evidence,
      });
    }

    return health;
  }

  /**
   * Get the current state of a component. Returns UNKNOWN if not registered.
   */
  getState(id: string): ComponentHealth {
    return (
      this.states.get(id) ?? {
        component: id,
        category: 'runtime',
        state: 'UNKNOWN',
        evidence: [],
        checkedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Get all component states.
   */
  getAllStates(): ComponentHealth[] {
    return Array.from(this.states.values());
  }

  /**
   * Get the overall system state. This is the worst state across all
   * registered components, with UNKNOWN treated as worse than HEALTHY
   * but better than FAILED.
   *
   * Severity ordering:
   *   HEALTHY < STARTING < DEGRADED < UNKNOWN < UNAVAILABLE < RECOVERING < BLOCKED < FAILED < ESCALATION_REQUIRED
   */
  getOverallState(): ComponentState {
    const states = Array.from(this.states.values()).map((s) => s.state);
    if (states.length === 0) return 'UNKNOWN';

    const severity: Record<ComponentState, number> = {
      HEALTHY: 0,
      STARTING: 1,
      DEGRADED: 2,
      UNKNOWN: 3,
      UNAVAILABLE: 4,
      RECOVERING: 5,
      BLOCKED: 6,
      FAILED: 7,
      ESCALATION_REQUIRED: 8,
    };

    let worst: ComponentState = 'HEALTHY';
    for (const s of states) {
      if (severity[s] > severity[worst]) worst = s;
    }
    return worst;
  }

  /**
   * Set a forwarder callback that receives every logged event.
   * Used by OperationalIntelligence to wire events to durable memory
   * without coupling the state model to the storage layer.
   */
  setEventForwarder(fn: (event: OperationalEvent) => void): void {
    this.eventForwarder = fn;
  }

  /**
   * Log an operational event. Also forwards to the event forwarder
   * (if set) so durable storage can record it.
   */
  logEvent(event: OperationalEvent): void {
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxEventLogSize) {
      this.eventLog.shift();
    }
    // Forward to durable storage (OperationalMemory) if wired
    try {
      this.eventForwarder?.(event);
    } catch {
      // Best effort — don't let storage failures break state tracking
    }
  }

  /**
   * Get recent operational events.
   */
  getRecentEvents(limit = 50): OperationalEvent[] {
    return this.eventLog.slice(-limit);
  }

  /**
   * Get events correlated by correlationId.
   */
  getCorrelatedEvents(correlationId: string): OperationalEvent[] {
    return this.eventLog.filter((e) => e.correlationId === correlationId);
  }

  /**
   * Get all events of a specific type.
   */
  getEventsByType(type: OperationalEvent['type']): OperationalEvent[] {
    return this.eventLog.filter((e) => e.type === type);
  }

  /**
   * Clear all state and events. Used for testing.
   */
  reset(): void {
    this.states.clear();
    this.eventLog = [];
  }

  /**
   * Get the full event log (for diagnostics).
   */
  getEventLog(): OperationalEvent[] {
    return [...this.eventLog];
  }
}
