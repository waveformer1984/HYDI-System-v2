/**
 * HYDI Goal State Machine
 *
 * Defines explicit goal states and valid transitions.
 * Invalid transitions are rejected.
 *
 * States:
 *   RUNNING              — actively executing
 *   PAUSED               — explicitly paused by user
 *   WAITING_FOR_HUMAN    — intervention requested
 *   WAITING_FOR_PROVIDER — provider unavailable, will retry
 *   RECOVERING           — recovering from a failure
 *   COMPLETED            — all objectives verified
 *   PARTIAL              — some objectives complete, some failed
 *   FAILED               — goal cannot be completed
 *   EXPIRED              — delegation expired
 *
 * Transitions:
 *   RUNNING → WAITING_FOR_HUMAN (intervention requested)
 *   RUNNING → WAITING_FOR_PROVIDER (provider failure)
 *   RUNNING → RECOVERING (failure detected)
 *   RUNNING → PAUSED (user paused)
 *   RUNNING → COMPLETED (all objectives verified)
 *   RUNNING → PARTIAL (some objectives failed)
 *   RUNNING → FAILED (unrecoverable failure)
 *   RUNNING → EXPIRED (delegation expired)
 *
 *   WAITING_FOR_HUMAN → REVALIDATING → RUNNING (human completed)
 *   WAITING_FOR_HUMAN → FAILED (human cancelled)
 *   WAITING_FOR_HUMAN → EXPIRED (intervention expired)
 *
 *   WAITING_FOR_PROVIDER → REVALIDATING → RUNNING (provider recovered)
 *   WAITING_FOR_PROVIDER → FAILED (provider unrecoverable)
 *
 *   RECOVERING → RUNNING (recovery succeeded)
 *   RECOVERING → FAILED (recovery failed)
 *
 *   PAUSED → RUNNING (user resumed)
 *   PAUSED → FAILED (user cancelled)
 *
 * Terminal states: COMPLETED, PARTIAL, FAILED, EXPIRED
 */

import type { GoalRuntimeStatus } from './GoalCheckpoint';

// ---------------------------------------------------------------------------
// State Transition Rules
// ---------------------------------------------------------------------------

/**
 * All valid state transitions.
 * Key = from state, Value = set of valid target states.
 */
const VALID_TRANSITIONS: Record<GoalRuntimeStatus, GoalRuntimeStatus[]> = {
  RUNNING: ['PAUSED', 'WAITING_FOR_HUMAN', 'WAITING_FOR_PROVIDER', 'RECOVERING', 'COMPLETED', 'PARTIAL', 'FAILED', 'EXPIRED'],
  PAUSED: ['RUNNING', 'FAILED'],
  WAITING_FOR_HUMAN: ['RUNNING', 'FAILED', 'EXPIRED'], // REVALIDATING is internal — transitions back to RUNNING
  WAITING_FOR_PROVIDER: ['RUNNING', 'FAILED', 'EXPIRED'],
  RECOVERING: ['RUNNING', 'FAILED'],
  COMPLETED: [], // terminal
  PARTIAL: [], // terminal
  FAILED: [], // terminal
  EXPIRED: [], // terminal
};

/**
 * Terminal states — no transitions out.
 */
const TERMINAL_STATES: Set<GoalRuntimeStatus> = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'EXPIRED']);

// ---------------------------------------------------------------------------
// Goal State Machine
// ---------------------------------------------------------------------------

/**
 * Manages goal state transitions with validation.
 */
export class GoalStateMachine {
  private states = new Map<string, GoalRuntimeStatus>();
  private transitionHistory = new Map<string, StateTransition[]>();

  /**
   * Initialize a goal's state.
   */
  initialize(goalId: string, initialStatus: GoalRuntimeStatus = 'RUNNING'): void {
    this.states.set(goalId, initialStatus);
    this.transitionHistory.set(goalId, [{
      from: 'RUNNING' as GoalRuntimeStatus, // synthetic initial transition
      to: initialStatus,
      timestamp: new Date().toISOString(),
      reason: 'Goal initialized',
    }]);
  }

  /**
   * Get the current state of a goal.
   */
  getState(goalId: string): GoalRuntimeStatus | null {
    return this.states.get(goalId) ?? null;
  }

  /**
   * Attempt a state transition.
   * Returns true if the transition is valid and was applied.
   * Returns false if the transition is invalid.
   */
  transition(goalId: string, to: GoalRuntimeStatus, reason: string): {
    success: boolean;
    from: GoalRuntimeStatus | null;
    reason: string;
  } {
    const from = this.states.get(goalId) ?? null;

    if (!from) {
      return { success: false, from: null, reason: `Goal ${goalId} not initialized` };
    }

    // Check if current state is terminal
    if (TERMINAL_STATES.has(from)) {
      return { success: false, from, reason: `Goal is in terminal state ${from} — no transitions allowed` };
    }

    // Check if transition is valid
    const allowed = VALID_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      return { success: false, from, reason: `Invalid transition: ${from} → ${to}` };
    }

    // Apply transition
    this.states.set(goalId, to);
    const history = this.transitionHistory.get(goalId) ?? [];
    history.push({ from, to, timestamp: new Date().toISOString(), reason });
    this.transitionHistory.set(goalId, history);

    return { success: true, from, reason: `Transitioned: ${from} → ${to}` };
  }

  /**
   * Get the transition history for a goal.
   */
  getHistory(goalId: string): StateTransition[] {
    return this.transitionHistory.get(goalId) ?? [];
  }

  /**
   * Check if a goal is in a terminal state.
   */
  isTerminal(goalId: string): boolean {
    const state = this.states.get(goalId);
    return state !== null && state !== undefined && TERMINAL_STATES.has(state);
  }

  /**
   * Check if a goal is waiting (for human or provider).
   */
  isWaiting(goalId: string): boolean {
    const state = this.states.get(goalId);
    return state === 'WAITING_FOR_HUMAN' || state === 'WAITING_FOR_PROVIDER';
  }

  /**
   * Serialize all goal states for persistence.
   */
  serialize(): Array<{ goalId: string; state: GoalRuntimeStatus; history: StateTransition[] }> {
    const result: Array<{ goalId: string; state: GoalRuntimeStatus; history: StateTransition[] }> = [];
    for (const [goalId, state] of this.states) {
      result.push({
        goalId,
        state,
        history: this.transitionHistory.get(goalId) ?? [],
      });
    }
    return result;
  }

  /**
   * Restore goal states from persistence.
   */
  restore(data: Array<{ goalId: string; state: GoalRuntimeStatus; history: StateTransition[] }>): void {
    this.states.clear();
    this.transitionHistory.clear();
    for (const entry of data) {
      this.states.set(entry.goalId, entry.state);
      this.transitionHistory.set(entry.goalId, entry.history);
    }
  }
}

// ---------------------------------------------------------------------------
// State Transition Record
// ---------------------------------------------------------------------------

export interface StateTransition {
  from: GoalRuntimeStatus;
  to: GoalRuntimeStatus;
  timestamp: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _stateMachine: GoalStateMachine | null = null;

export function getGoalStateMachine(): GoalStateMachine {
  if (!_stateMachine) {
    _stateMachine = new GoalStateMachine();
  }
  return _stateMachine;
}
