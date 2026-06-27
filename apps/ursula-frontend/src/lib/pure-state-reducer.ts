// PURE STATE REDUCER - No side effects, no external dependencies
// Pure function: (state, event) => newState

import { TaskEvent } from './event-sourced-ledger.js';
import { TaskState } from './task-state-projection.js';
import { normalizeTaskStatus } from './task-status';

export type PureReducerFunction<S, E> = (state: S, event: E) => S;

export interface ReducerResult {
  newState: TaskState;
  sideEffects: string[]; // Track any attempted side effects
  externalCalls: string[]; // Track any external dependencies
}

function mapStatusForProjection(rawStatus: unknown): TaskState['status'] {
  return normalizeTaskStatus(rawStatus as string | undefined);
}

/**
 * Pure reducer for task state - no side effects guaranteed
 */
export class PureTaskStateReducer {
  private static sideEffectDetected = false;
  private static externalCallDetected = false;

  /**
   * Pure reduce function - guaranteed no side effects
   */
  static reduce(currentState: TaskState | null, event: TaskEvent): ReducerResult {
    // Reset detection flags
    this.sideEffectDetected = false;
    this.externalCallDetected = false;

    // Validate inputs
    if (!event || !event.event_type || !event.task_id) {
      throw new Error('Invalid event: missing required fields');
    }

    let newState: TaskState;

    // Handle each event type purely
    switch (event.event_type) {
      case 'task_created':
        newState = this.handleTaskCreated(currentState, event);
        break;

      case 'task_updated':
        newState = this.handleTaskUpdated(currentState, event);
        break;

      case 'task_claimed':
        newState = this.handleTaskClaimed(currentState, event);
        break;

      case 'task_completed':
        newState = this.handleTaskCompleted(currentState, event);
        break;

      case 'task_failed':
        newState = this.handleTaskFailed(currentState, event);
        break;

      default:
        // Unknown event type - return state unchanged
        newState = currentState || this.createEmptyTask(event.task_id);
        break;
    }

    // Ensure immutability
    newState = JSON.parse(JSON.stringify(newState));

    return {
      newState,
      sideEffects: this.sideEffectDetected ? ['Side effect detected'] : [],
      externalCalls: this.externalCallDetected ? ['External call detected'] : []
    };
  }

  /**
   * Handle task creation - pure function
   */
  private static handleTaskCreated(currentState: TaskState | null, event: TaskEvent): TaskState {
    if (currentState && currentState.task_id === event.task_id) {
      // Task already exists - this is an error condition
      throw new Error(`Task ${event.task_id} already exists`);
    }

    // Create new task from event data
    return {
      task_id: event.task_id,
      source: event.data?.source || 'unknown',
      system: event.data?.system || 'unknown',
      type: event.data?.type || 'unknown',
      title: event.data?.title || 'Untitled Task',
      description: event.data?.description || '',
      inputs: event.data?.inputs || {},
      outputs_expected: event.data?.outputs_expected || {},
      dependencies: event.data?.dependencies || [],
      priority: event.data?.priority || 1,
      urgency: event.data?.urgency || 1,
      revenue_impact: event.data?.revenue_impact || { stage: 'potential', value: 0 },
      status: 'planned',
      state_version: 1,
      retry_count: 0,
      max_retries: event.data?.max_retries || 3,
      fix_attempts: 0,
      max_fix_attempts: event.data?.max_fix_attempts || 3,
      execution_mode: event.data?.execution_mode || 'file',
      created_at: event.timestamp,
      updated_at: event.timestamp,
      last_event_sequence: event.sequence_number
    };
  }

  /**
   * Handle task update - pure function
   */
  private static handleTaskUpdated(currentState: TaskState | null, event: TaskEvent): TaskState {
    if (!currentState || currentState.task_id !== event.task_id) {
      throw new Error(`Cannot update non-existent task ${event.task_id}`);
    }

    // Create new state with updates
    const normalizedStatus = event.data?.status ? mapStatusForProjection(event.data.status) : undefined;

    const updatedState: TaskState = {
      ...currentState,
      ...event.data, // Merge event data
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      state_version: (event.data?.state_version || currentState.state_version) + 1,
      updated_at: event.timestamp,
      last_event_sequence: event.sequence_number
    };

    // Validate status transitions
    if (normalizedStatus && !this.isValidStatusTransition(currentState.status, normalizedStatus)) {
      throw new Error(`Invalid status transition: ${currentState.status} -> ${normalizedStatus}`);
    }

    return updatedState;
  }

  /**
   * Handle task claim - pure function
   */
  private static handleTaskClaimed(currentState: TaskState | null, event: TaskEvent): TaskState {
    if (!currentState || currentState.task_id !== event.task_id) {
      throw new Error(`Cannot claim non-existent task ${event.task_id}`);
    }

    if (currentState.status !== 'queued') {
      throw new Error(`Cannot claim task in status ${currentState.status}`);
    }

    return {
      ...currentState,
      status: 'queued',
      locked_by: event.data?.worker_id,
      claimed_at: event.timestamp,
      state_version: currentState.state_version + 1,
      updated_at: event.timestamp,
      last_event_sequence: event.sequence_number
    };
  }

  /**
   * Handle task completion - pure function
   */
  private static handleTaskCompleted(currentState: TaskState | null, event: TaskEvent): TaskState {
    if (!currentState || currentState.task_id !== event.task_id) {
      throw new Error(`Cannot complete non-existent task ${event.task_id}`);
    }

    if (currentState.status !== 'running' && currentState.status !== 'waiting_review') {
      throw new Error(`Cannot complete task in status ${currentState.status}`);
    }

    return {
      ...currentState,
      status: 'completed',
      state_version: currentState.state_version + 1,
      updated_at: event.timestamp,
      outputs_expected: event.data?.outputs || currentState.outputs_expected,
      last_event_sequence: event.sequence_number
    };
  }

  /**
   * Handle task failure - pure function
   */
  private static handleTaskFailed(currentState: TaskState | null, event: TaskEvent): TaskState {
    if (!currentState || currentState.task_id !== event.task_id) {
      throw new Error(`Cannot fail non-existent task ${event.task_id}`);
    }

    const newRetryCount = currentState.retry_count + 1;
    const shouldRetry = newRetryCount < currentState.max_retries;

    return {
      ...currentState,
      status: shouldRetry ? 'queued' : 'failed_retryable',
      retry_count: newRetryCount,
      state_version: currentState.state_version + 1,
      updated_at: event.timestamp,
      last_event_sequence: event.sequence_number
    };
  }

  /**
   * Create empty task template
   */
  private static createEmptyTask(taskId: string): TaskState {
    return {
      task_id: taskId,
      source: 'unknown',
      system: 'unknown',
      type: 'unknown',
      title: 'Untitled Task',
      description: '',
      inputs: {},
      outputs_expected: {},
      dependencies: [],
      priority: 1,
      urgency: 1,
      revenue_impact: { stage: 'potential', value: 0 },
      status: 'planned',
      state_version: 1,
      retry_count: 0,
      max_retries: 3,
      fix_attempts: 0,
      max_fix_attempts: 3,
      execution_mode: 'file',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_event_sequence: 0
    };
  }

  /**
   * Validate status transitions
   */
  private static isValidStatusTransition(from: TaskState['status'], to: TaskState['status']): boolean {
    const validTransitions: Record<TaskState['status'], TaskState['status'][]> = {
      planned: ['queued'],
      queued: ['running', 'failed_retryable', 'failed_terminal'],
      running: ['waiting_review', 'completed', 'failed_retryable', 'failed_terminal'],
      waiting_review: ['running', 'completed', 'failed_terminal'],
      completed: [],
      failed_retryable: ['queued', 'running', 'failed_terminal'],
      failed_terminal: []
    };

    return validTransitions[from]?.includes(to) || false;
  }

  /**
   * Verify purity of reducer function
   */
  static verifyPurity(): {
    isPure: boolean;
    hasSideEffects: boolean;
    hasExternalDependencies: boolean;
  } {
    return {
      isPure: !this.sideEffectDetected && !this.externalCallDetected,
      hasSideEffects: this.sideEffectDetected,
      hasExternalDependencies: this.externalCallDetected
    };
  }
}

/**
 * Pure event stream reducer - reduces entire stream to state
 */
export function reduceEventStream(events: TaskEvent[]): Map<string, TaskState> {
  const stateMap = new Map<string, TaskState>();

  for (const event of events) {
    const currentState = stateMap.get(event.task_id) || null;
    const result = PureTaskStateReducer.reduce(currentState, event);

    // Check for purity violations
    if (result.sideEffects.length > 0 || result.externalCalls.length > 0) {
      throw new Error('Reducer purity violation detected');
    }

    stateMap.set(event.task_id, result.newState);
  }

  return stateMap;
}
