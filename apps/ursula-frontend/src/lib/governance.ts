/**
 * GOVERNANCE LAYER - State Machine Enforcement
 * Enforces architectural constraints between Cascade/Windsurf and API
 */

import { TransitionRegistry, type TaskState as RegistryTaskState } from './transition-registry';
import { VersionedGovernance } from './versioned-governance';
import { GlobalSafetyValves } from './global-safety-valves';
import { toStorageTaskStatus } from './task-status';
import type { CanonicalTaskStatus } from './task-status';

export type TaskState = RegistryTaskState | CanonicalTaskStatus;

export interface TaskBudget {
  retry_count: number;
  max_retries: number;
  fix_attempts: number;
  max_fix_attempts: number;
}

export interface GovernanceError {
  type: "invalid_transition" | "budget_exceeded" | "terminal_violation" | "canonical_state";
  message: string;
  from?: string;
  to?: string;
  allowed?: string[];
}

export class TaskGovernance {
  // Canonical state mapping
  private static readonly STATE_MAPPING: Record<string, RegistryTaskState> = {
    // Canonical lifecycle -> storage/runtime lifecycle
    "planned": toStorageTaskStatus("planned"),
    "waiting_review": toStorageTaskStatus("waiting_review"),
    "failed_retryable": toStorageTaskStatus("failed_retryable"),
    "failed_terminal": toStorageTaskStatus("failed_terminal"),
    // Legacy aliases
    "in_progress": "running",
    "assigned": "queued",
    "done": "completed",
    "complete": "completed",
    "resolv": "resolving",
    "hardfail": "hard_failed",
    "retry": "retrying",
    "pending": "pending",
    "claimed": "claimed",
    "queued": "queued",
    "running": "running",
    "failed": "failed",
    "hard_failed": "hard_failed",
    "completed": "completed"
  };

  // Default budget limits
  private static readonly DEFAULT_BUDGET: TaskBudget = {
    retry_count: 0,
    max_retries: 3,
    fix_attempts: 0,
    max_fix_attempts: 3
  };

  /**
   * Canonicalize state to ensure consistency
   */
  static canonicalizeState(state: string): RegistryTaskState {
    const canonical = this.STATE_MAPPING[state];
    if (!canonical) {
      throw new Error(`Invalid state: ${state}. Valid states: ${Object.keys(this.STATE_MAPPING).join(', ')}`);
    }
    return canonical;
  }

  /**
   * Validate state transition
   */
  static validateTransition(from: TaskState, to: TaskState): GovernanceError | null {
    // Check if transition is allowed
    const fromRegistryState = this.canonicalizeState(from);
    const toRegistryState = this.canonicalizeState(to);
    const allowed = TransitionRegistry.getAllowedTransitions(fromRegistryState);
    if (!allowed.includes(toRegistryState)) {
      return {
        type: "invalid_transition",
        message: `Invalid transition from ${from} to ${to}`,
        from,
        to,
        allowed
      };
    }

    return null;
  }

  /**
   * Check if state is terminal
   */
  static isTerminal(state: TaskState): boolean {
    const registryState = this.canonicalizeState(state);
    return TransitionRegistry.isTerminal(registryState);
  }

  /**
   * Enforce budget constraints
   */
  static enforceBudget(task: any, transitionTo: TaskState): GovernanceError | null {
    const budget: TaskBudget = {
      ...this.DEFAULT_BUDGET,
      ...task
    };

    // Check retry budget
    if (transitionTo === "retrying") {
      if (budget.retry_count >= budget.max_retries) {
        return {
          type: "budget_exceeded",
          message: `Retry budget exceeded: ${budget.retry_count}/${budget.max_retries}`
        };
      }
    }

    // Check fix budget
    if (task.type === "fix" && transitionTo === "running") {
      if (budget.fix_attempts >= budget.max_fix_attempts) {
        return {
          type: "budget_exceeded",
          message: `Fix budget exceeded: ${budget.fix_attempts}/${budget.max_fix_attempts}`
        };
      }
    }

    return null;
  }

  /**
   * Govern task update - full validation
   */
  static governTaskUpdate(currentTask: any, updates: any): {
    allowed: boolean;
    errors: GovernanceError[];
    sanitizedUpdates: any;
  } {
    const errors: GovernanceError[] = [];
    const sanitizedUpdates: any = { ...updates };

    try {
      // 1. Canonicalize state if provided
      if (updates.status) {
        const canonicalTo = this.canonicalizeState(updates.status);
        sanitizedUpdates.status = canonicalTo;

        // 2. Validate transition if current task has state
        if (currentTask.status) {
          const canonicalFrom = this.canonicalizeState(currentTask.status);

          const transitionError = this.validateTransition(canonicalFrom, canonicalTo);
          if (transitionError) {
            errors.push(transitionError);
          }
        }

        // 3. Check terminal state protection
        if (currentTask.status && this.isTerminal(this.canonicalizeState(currentTask.status))) {
          errors.push({
            type: "terminal_violation",
            message: `Cannot transition from terminal state: ${currentTask.status}`
          });
        }

        // 4. Enforce budget constraints
        const budgetError = this.enforceBudget(currentTask, canonicalTo);
        if (budgetError) {
          errors.push(budgetError);
        }
      }

      // 5. Initialize budget fields if missing
      if (currentTask.retry_count === undefined) {
        sanitizedUpdates.retry_count = currentTask.retry_count || 0;
      }
      if (currentTask.max_retries === undefined) {
        sanitizedUpdates.max_retries = currentTask.max_retries || this.DEFAULT_BUDGET.max_retries;
      }
      if (currentTask.fix_attempts === undefined) {
        sanitizedUpdates.fix_attempts = currentTask.fix_attempts || 0;
      }
      if (currentTask.max_fix_attempts === undefined) {
        sanitizedUpdates.max_fix_attempts = currentTask.max_fix_attempts || this.DEFAULT_BUDGET.max_fix_attempts;
      }

      return {
        allowed: errors.length === 0,
        errors,
        sanitizedUpdates
      };

    } catch (error) {
      errors.push({
        type: "canonical_state",
        message: error instanceof Error ? error.message : "Unknown governance error"
      });

      return {
        allowed: false,
        errors,
        sanitizedUpdates: updates
      };
    }
  }

  /**
   * Validate task creation with safety valve checks
   */
  static validateTaskCreation(task: any): { valid: boolean; error?: string } {
    // Check global safety valves first
    const safetyValves = GlobalSafetyValves.getInstance();
    const safetyCheck = safetyValves.canAcceptTask(task);
    if (!safetyCheck.allowed) {
      return { valid: false, error: safetyCheck.reason };
    }

    // STRICT: Enforce version requirement at API boundary
    if (task.state_version === undefined || task.state_version === null) {
      return { valid: false, error: "state_version is required for all tasks" };
    }

    // Validate required fields
    if (!task.title || !task.type || !task.system) {
      return { valid: false, error: "Missing required task fields" };
    }

    // Validate task type
    const VALID_TASK_TYPES = ["test", "build", "deploy", "fix", "diagnostic", "monitor", "research", "validate"];
    if (!VALID_TASK_TYPES.includes(task.type)) {
      return { valid: false, error: `Invalid task type: ${task.type}` };
    }

    // Validate initial state
      if (task.status) {
        try {
          this.canonicalizeState(task.status);
        } catch {
          return { valid: false, error: `Invalid initial state: ${task.status}` };
        }
      }

    // Validate budget
    if (task.retry_count > task.max_retries) {
      return { valid: false, error: "Retry budget exceeded" };
    }

    return { valid: true };
  }

  /**
   * STRICT: Enforce version check for all state updates
   */
  static validateStateUpdate(task: any, updates: any): { valid: boolean; error?: string } {
    // CRITICAL: Version must be present for ALL updates
    if (updates.state_version === undefined && task.state_version === undefined) {
      return { valid: false, error: "state_version is required for state updates" };
    }

    // If updating version, it must be incremented
    if (updates.state_version !== undefined) {
      if (task.state_version !== undefined && updates.state_version <= task.state_version) {
        return { valid: false, error: "state_version must be greater than current version" };
      }
    }

    return { valid: true };
  }

  /**
   * Generate failure signature
   */
  static generateFailureSignature(error: string, taskType: string): string {
    const signature = Buffer.from(`${error}${taskType}`).toString('base64')
      .replace(/[+/=]/g, '')
      .substring(0, 8);
    return signature;
  }

  /**
   * Check if task should be moved to DLQ
   */
  static shouldMoveToDLQ(task: any): boolean {
    return task.status === "hard_failed" ||
      (task.retry_count >= task.max_retries && task.status === "failed");
  }

  /**
   * Get allowed transitions for a state
   */
  static getAllowedTransitions(state: TaskState): TaskState[] {
    const registryState = this.canonicalizeState(state);
    return TransitionRegistry.getAllowedTransitions(registryState) as TaskState[];
  }

  /**
   * Get all canonical states
   */
  static getAllStates(): TaskState[] {
    return Object.keys(this.STATE_MAPPING) as TaskState[];
  }
}
