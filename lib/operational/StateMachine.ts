/**
 * HYDI Operational State Machine
 *
 * Phase 4 — Formalizes legal state transitions and prevents impossible ones.
 *
 * Every state transition is validated against this machine. Illegal transitions
 * are rejected and logged. This prevents the system from entering impossible
 * states (e.g., HEALTHY → RECOVERING without going through UNAVAILABLE first).
 *
 * Legal transitions:
 *   UNKNOWN → STARTING | HEALTHY | UNAVAILABLE | DEGRADED
 *   STARTING → HEALTHY | DEGRADED | UNAVAILABLE
 *   HEALTHY → DEGRADED | UNAVAILABLE
 *   DEGRADED → HEALTHY | UNAVAILABLE
 *   UNAVAILABLE → RECOVERING | BLOCKED
 *   RECOVERING → HEALTHY | DEGRADED | FAILED | BLOCKED
 *   BLOCKED → RECOVERING | HEALTHY | UNAVAILABLE
 *   FAILED → ESCALATION_REQUIRED | RECOVERING
 *   ESCALATION_REQUIRED → RECOVERING | HEALTHY
 *
 * Illegal transitions (examples):
 *   HEALTHY → RECOVERING (no recovery needed when healthy)
 *   HEALTHY → FAILED (must go through UNAVAILABLE first)
 *   ESCALATION_REQUIRED → HEALTHY (without recovery — needs human or explicit recheck)
 */

import type { ComponentState } from './types';

const LEGAL_TRANSITIONS: Record<ComponentState, ComponentState[]> = {
  UNKNOWN: ['STARTING', 'HEALTHY', 'UNAVAILABLE', 'DEGRADED'],
  STARTING: ['HEALTHY', 'DEGRADED', 'UNAVAILABLE'],
  HEALTHY: ['DEGRADED', 'UNAVAILABLE'],
  DEGRADED: ['HEALTHY', 'UNAVAILABLE'],
  UNAVAILABLE: ['RECOVERING', 'BLOCKED'],
  RECOVERING: ['HEALTHY', 'DEGRADED', 'FAILED', 'BLOCKED'],
  BLOCKED: ['RECOVERING', 'HEALTHY', 'UNAVAILABLE'],
  FAILED: ['ESCALATION_REQUIRED', 'RECOVERING'],
  ESCALATION_REQUIRED: ['RECOVERING', 'HEALTHY'],
};

export class StateMachine {
  /**
   * Check whether a transition is legal.
   */
  isLegalTransition(from: ComponentState, to: ComponentState): boolean {
    // Same-state is always legal (no transition)
    if (from === to) return true;
    const allowed = LEGAL_TRANSITIONS[from] ?? [];
    return allowed.includes(to);
  }

  /**
   * Validate a transition. Returns the target state if legal, or throws
   * with a descriptive error if illegal.
   */
  validateTransition(from: ComponentState, to: ComponentState): ComponentState {
    if (this.isLegalTransition(from, to)) {
      return to;
    }
    const allowed = LEGAL_TRANSITIONS[from] ?? [];
    throw new Error(
      `Illegal state transition: ${from} → ${to}. Legal transitions from ${from}: [${allowed.join(', ')}]`,
    );
  }

  /**
   * Get all legal target states from a given state.
   */
  getLegalTransitions(from: ComponentState): ComponentState[] {
    return [...(LEGAL_TRANSITIONS[from] ?? [])];
  }

  /**
   * Get the full transition table (for diagnostics).
   */
  getTransitionTable(): Record<ComponentState, ComponentState[]> {
    return { ...LEGAL_TRANSITIONS };
  }
}

/**
 * Singleton state machine instance.
 */
export const stateMachine = new StateMachine();
