/**
 * ATOMIC GOVERNANCE LAYER
 * No state change without passing governance in the same transaction boundary
 */

import { TaskGovernance, TaskState, GovernanceError } from './governance';

export interface AtomicUpdateRequest {
  task_id: string;
  status?: TaskState;
  result?: any;
  error?: string;
  [key: string]: any;
}

export interface AtomicUpdateResult {
  success: boolean;
  task?: any;
  error?: string;
  violations?: GovernanceError[];
  http_status?: number;
}

export class AtomicGovernance {
  /**
   * ATOMIC COMMIT: Validate before write, reject before commit
   */
  static async commitTaskUpdate(
    getCurrentTask: (task_id: string) => Promise<any>,
    writeTask: (task: any) => Promise<void>,
    request: AtomicUpdateRequest
  ): Promise<AtomicUpdateResult> {
    try {
      // STEP 1: Get current state
      const currentTask = await getCurrentTask(request.task_id);
      if (!currentTask) {
        return {
          success: false,
          error: 'Task not found',
          http_status: 404
        };
      }

      // STEP 2: Apply governance validation
      const governance = TaskGovernance.governTaskUpdate(currentTask, request);

      if (!governance.allowed) {
        // Categorize violations for HTTP status codes
        const http_status = this.categorizeViolation(governance.errors);
        
        return {
          success: false,
          error: 'Update rejected by governance rules',
          violations: governance.errors,
          http_status
        };
      }

      // STEP 3: Apply sanitized updates with budget counters
      const updatedTask = {
        ...currentTask,
        ...governance.sanitizedUpdates,
        updated_at: new Date().toISOString()
      };

      // Increment budget counters atomically
      if (governance.sanitizedUpdates.status === "retrying") {
        updatedTask.retry_count = (updatedTask.retry_count || 0) + 1;
      }
      if (currentTask.type === "fix" && governance.sanitizedUpdates.status === "running") {
        updatedTask.fix_attempts = (updatedTask.fix_attempts || 0) + 1;
      }

      // Check DLQ conditions atomically
      if (TaskGovernance.shouldMoveToDLQ(updatedTask)) {
        updatedTask.status = "hard_failed";
        updatedTask.dlq_moved_at = new Date().toISOString();
      }

      // STEP 4: ATOMIC WRITE - single operation
      await writeTask(updatedTask);

      return {
        success: true,
        task: updatedTask
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        http_status: 500
      };
    }
  }

  /**
   * Categorize governance violations for HTTP status codes
   */
  private static categorizeViolation(errors: GovernanceError[]): number {
    if (!errors || errors.length === 0) return 200;

    const firstError = errors[0];

    switch (firstError.type) {
      case "invalid_transition":
        return 409; // Conflict
      case "budget_exceeded":
        return 429; // Too Many Requests
      case "terminal_violation":
        return 403; // Forbidden
      case "canonical_state":
        return 400; // Bad Request
      default:
        return 400;
    }
  }

  /**
   * STATE VERSIONING for optimistic locking
   */
  static async commitWithVersioning(
    getCurrentTask: (task_id: string) => Promise<any>,
    writeTaskWithVersion: (task: any, expectedVersion: number) => Promise<boolean>,
    request: AtomicUpdateRequest
  ): Promise<AtomicUpdateResult> {
    try {
      const currentTask = await getCurrentTask(request.task_id);
      if (!currentTask) {
        return {
          success: false,
          error: 'Task not found',
          http_status: 404
        };
      }

      const currentVersion = currentTask.state_version || 0;
      
      // Apply governance
      const governance = TaskGovernance.governTaskUpdate(currentTask, request);
      if (!governance.allowed) {
        const http_status = this.categorizeViolation(governance.errors);
        return {
          success: false,
          error: 'Update rejected by governance rules',
          violations: governance.errors,
          http_status
        };
      }

      // Prepare updated task with incremented version
      const updatedTask = {
        ...currentTask,
        ...governance.sanitizedUpdates,
        state_version: currentVersion + 1,
        updated_at: new Date().toISOString()
      };

      // Budget counters
      if (governance.sanitizedUpdates.status === "retrying") {
        updatedTask.retry_count = (updatedTask.retry_count || 0) + 1;
      }
      if (currentTask.type === "fix" && governance.sanitizedUpdates.status === "running") {
        updatedTask.fix_attempts = (updatedTask.fix_attempts || 0) + 1;
      }

      // DLQ check
      if (TaskGovernance.shouldMoveToDLQ(updatedTask)) {
        updatedTask.status = "hard_failed";
        updatedTask.dlq_moved_at = new Date().toISOString();
      }

      // ATOMIC WRITE with version check
      const writeSuccess = await writeTaskWithVersion(updatedTask, currentVersion);
      
      if (!writeSuccess) {
        return {
          success: false,
          error: 'Version conflict - task was modified by another process',
          http_status: 409
        };
      }

      return {
        success: true,
        task: updatedTask
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        http_status: 500
      };
    }
  }

  /**
   * BATCH ATOMIC COMMIT for multiple tasks
   */
  static async commitBatch(
    getCurrentTask: (task_id: string) => Promise<any>,
    writeTask: (task: any) => Promise<void>,
    requests: AtomicUpdateRequest[]
  ): Promise<{ success: boolean; results: AtomicUpdateResult[] }> {
    const results: AtomicUpdateResult[] = [];
    
    // Validate all first (fail fast)
    for (const request of requests) {
      const currentTask = await getCurrentTask(request.task_id);
      if (!currentTask) {
        results.push({
          success: false,
          error: 'Task not found',
          http_status: 404
        });
        continue;
      }

      const governance = TaskGovernance.governTaskUpdate(currentTask, request);
      if (!governance.allowed) {
        const http_status = this.categorizeViolation(governance.errors);
        results.push({
          success: false,
          error: 'Update rejected by governance rules',
          violations: governance.errors,
          http_status
        });
        continue;
      }

      results.push({ success: true }); // Placeholder
    }

    // If any validation failed, reject entire batch
    const hasFailures = results.some(r => !r.success);
    if (hasFailures) {
      return { success: false, results };
    }

    // All validations passed - execute writes
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      const currentTask = await getCurrentTask(request.task_id);
      
      const governance = TaskGovernance.governTaskUpdate(currentTask, request);
      const updatedTask = {
        ...currentTask,
        ...governance.sanitizedUpdates,
        updated_at: new Date().toISOString()
      };

      // Budget counters
      if (governance.sanitizedUpdates.status === "retrying") {
        updatedTask.retry_count = (updatedTask.retry_count || 0) + 1;
      }
      if (currentTask.type === "fix" && governance.sanitizedUpdates.status === "running") {
        updatedTask.fix_attempts = (updatedTask.fix_attempts || 0) + 1;
      }

      // DLQ check
      if (TaskGovernance.shouldMoveToDLQ(updatedTask)) {
        updatedTask.status = "hard_failed";
        updatedTask.dlq_moved_at = new Date().toISOString();
      }

      await writeTask(updatedTask);
      results[i] = { success: true, task: updatedTask };
    }

    return { success: true, results };
  }
}
