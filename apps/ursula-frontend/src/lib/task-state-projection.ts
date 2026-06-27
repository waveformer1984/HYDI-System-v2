// TASK STATE PROJECTION - Derived view from event stream
// Task state is NOT stored truth - it's computed from events

import { TaskEvent, EventSourcedLedger } from './event-sourced-ledger.js';
import { CanonicalTaskStatus, normalizeTaskStatus } from './task-status';

export interface TaskState {
  task_id: string;
  source: string;
  system: string;
  type: string;
  title: string;
  description: string;
  inputs: any;
  outputs_expected: any;
  dependencies: string[];
  priority: number;
  urgency: number;
  revenue_impact: any;
  status: CanonicalTaskStatus;
  state_version: number;
  retry_count: number;
  max_retries: number;
  fix_attempts: number;
  max_fix_attempts: number;
  execution_mode: 'redis' | 'file';
  created_at: string;
  updated_at: string;
  claimed_at?: string;
  locked_by?: string;
  result?: any;
  error?: string;
  last_event_sequence: number;
}

export class TaskStateProjection {
  private ledger: EventSourcedLedger;
  private taskStates: Map<string, TaskState> = new Map();

  constructor(ledger: EventSourcedLedger) {
    this.ledger = ledger;
  }

  async rebuild(): Promise<void> {
    // Clear current projection
    this.taskStates.clear();

    // Replay all events to rebuild state
    const events = await this.ledger.replayEvents();

    for (const event of events) {
      await this.applyEvent(event);
    }
  }

  async applyEvent(event: TaskEvent): Promise<void> {
    switch (event.event_type) {
      case 'task_created':
        await this.handleTaskCreated(event);
        break;
      case 'task_updated':
        await this.handleTaskUpdated(event);
        break;
      case 'task_claimed':
        await this.handleTaskClaimed(event);
        break;
      case 'task_completed':
        await this.handleTaskCompleted(event);
        break;
      case 'task_failed':
        await this.handleTaskFailed(event);
        break;
    }
  }

  private async handleTaskCreated(event: TaskEvent): Promise<void> {
    const taskData = event.data;
    const taskState: TaskState = {
      task_id: event.task_id,
      source: taskData.source || 'manual',
      system: taskData.system,
      type: taskData.type,
      title: taskData.title,
      description: taskData.description,
      inputs: taskData.inputs || {},
      outputs_expected: taskData.outputs_expected || {},
      dependencies: taskData.dependencies || [],
      priority: taskData.priority || 1,
      urgency: taskData.urgency || 1,
      revenue_impact: taskData.revenue_impact || { stage: 'partial', value: 50 },
      status: 'planned',
      state_version: taskData.state_version || 1,
      retry_count: 0,
      max_retries: taskData.max_retries || 3,
      fix_attempts: 0,
      max_fix_attempts: taskData.max_fix_attempts || 3,
      execution_mode: taskData.execution_mode || 'file',
      created_at: event.timestamp,
      updated_at: event.timestamp,
      last_event_sequence: event.sequence_number
    };

    this.taskStates.set(event.task_id, taskState);
  }

  private async handleTaskUpdated(event: TaskEvent): Promise<void> {
    const currentState = this.taskStates.get(event.task_id);
    if (!currentState) {
      console.error(`Task ${event.task_id} not found for update event`);
      return;
    }

    // Apply updates from event data
    const updates = event.data;

    // Only update valid fields
    if (updates.status) {
      const nextStatus = normalizeTaskStatus(updates.status);
      if (this.isValidStatusTransition(currentState.status, nextStatus)) {
        currentState.status = nextStatus;
      }
    }

    if (updates.state_version !== undefined) {
      currentState.state_version = updates.state_version;
    }

    if (updates.result !== undefined) {
      currentState.result = updates.result;
    }

    if (updates.error !== undefined) {
      currentState.error = updates.error;
    }

    if (updates.locked_by !== undefined) {
      currentState.locked_by = updates.locked_by;
    }

    if (updates.claimed_at !== undefined) {
      currentState.claimed_at = updates.claimed_at;
    }

    currentState.updated_at = event.timestamp;
    currentState.last_event_sequence = event.sequence_number;
  }

  private async handleTaskClaimed(event: TaskEvent): Promise<void> {
    const currentState = this.taskStates.get(event.task_id);
    if (!currentState) {
      console.error(`Task ${event.task_id} not found for claim event`);
      return;
    }

    currentState.status = 'queued';
    currentState.locked_by = event.worker_id;
    currentState.claimed_at = event.timestamp;
    currentState.updated_at = event.timestamp;
    currentState.last_event_sequence = event.sequence_number;
  }

  private async handleTaskCompleted(event: TaskEvent): Promise<void> {
    const currentState = this.taskStates.get(event.task_id);
    if (!currentState) {
      console.error(`Task ${event.task_id} not found for completion event`);
      return;
    }

    currentState.status = 'completed';
    currentState.result = event.data.result;
    currentState.updated_at = event.timestamp;
    currentState.last_event_sequence = event.sequence_number;
  }

  private async handleTaskFailed(event: TaskEvent): Promise<void> {
    const currentState = this.taskStates.get(event.task_id);
    if (!currentState) {
      console.error(`Task ${event.task_id} not found for failure event`);
      return;
    }

    currentState.status = 'failed_retryable';
    currentState.error = event.data.error;
    currentState.updated_at = event.timestamp;
    currentState.last_event_sequence = event.sequence_number;
  }

  private isValidStatusTransition(from: string, to: string): boolean {
    const validTransitions: Record<string, string[]> = {
      planned: ['queued', 'failed_terminal'],
      queued: ['running', 'failed_retryable', 'failed_terminal'],
      running: ['waiting_review', 'completed', 'failed_retryable', 'failed_terminal'],
      waiting_review: ['running', 'completed', 'failed_retryable', 'failed_terminal'],
      completed: [],
      failed_retryable: ['queued'],
      failed_terminal: []
    };

    return validTransitions[from]?.includes(to) || false;
  }

  getTask(taskId: string): TaskState | undefined {
    return this.taskStates.get(taskId);
  }

  getAllTasks(): TaskState[] {
    return Array.from(this.taskStates.values());
  }

  getTasksByStatus(status: TaskState['status']): TaskState[] {
    return this.getAllTasks().filter(task => task.status === status);
  }

  getTasksBySystem(system: string): TaskState[] {
    return this.getAllTasks().filter(task => task.system === system);
  }

  // Export to legacy format for compatibility
  exportToLegacyFormat(): any[] {
    return this.getAllTasks().map(task => ({
      task_id: task.task_id,
      source: task.source,
      system: task.system,
      type: task.type,
      title: task.title,
      description: task.description,
      inputs: task.inputs,
      outputs_expected: task.outputs_expected,
      dependencies: task.dependencies,
      priority: task.priority,
      urgency: task.urgency,
      revenue_impact: task.revenue_impact,
      status: task.status,
      state_version: task.state_version,
      retry_count: task.retry_count,
      max_retries: task.max_retries,
      fix_attempts: task.fix_attempts,
      max_fix_attempts: task.max_fix_attempts,
      execution_mode: task.execution_mode,
      created_at: task.created_at,
      updated_at: task.updated_at,
      claimed_at: task.claimed_at,
      locked_by: task.locked_by,
      result: task.result,
      error: task.error
    }));
  }

  // Debug method to show projection health
  getProjectionStats(): {
    totalTasks: number;
    tasksByStatus: Record<string, number>;
    lastEventSequence: number;
  } {
    const tasks = this.getAllTasks();
    const tasksByStatus: Record<string, number> = {};

    for (const task of tasks) {
      tasksByStatus[task.status] = (tasksByStatus[task.status] || 0) + 1;
    }

    const lastEventSequence = Math.max(0, ...tasks.map(t => t.last_event_sequence));

    return {
      totalTasks: tasks.length,
      tasksByStatus,
      lastEventSequence
    };
  }
}
