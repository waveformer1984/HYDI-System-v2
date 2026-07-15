/**
 * VERSIONED GOVERNANCE LAYER
 * Eliminates silent overwrites with optimistic locking
 */

import { AtomicGovernance, AtomicUpdateRequest, AtomicUpdateResult } from './atomic-governance';
import { TaskGovernance, TaskState } from './governance';

export interface VersionedTask {
  task_id: string;
  state_version: number;
  [key: string]: any;
}

export interface VersionedUpdateRequest extends AtomicUpdateRequest {
  expected_version?: number;
}

export interface VersionedUpdateResult extends AtomicUpdateResult {
  current_version?: number;
  conflict_detected?: boolean;
}

export class VersionedGovernance {
  /**
   * VERSIONED COMMIT: Validate + version check + atomic write
   */
  static async commitWithOptimisticLocking(
    getCurrentTask: (task_id: string) => Promise<VersionedTask | null>,
    writeTaskWithVersion: (task: VersionedTask) => Promise<boolean>,
    request: VersionedUpdateRequest
  ): Promise<VersionedUpdateResult> {
    try {
      // STEP 1: Get current task
      const currentTask = await getCurrentTask(request.task_id);
      if (!currentTask) {
        return {
          success: false,
          error: 'Task not found',
          http_status: 404
        };
      }

      const currentVersion = currentTask.state_version || 0;

      // STEP 2: Version validation
      if (request.expected_version !== undefined) {
        if (request.expected_version !== currentVersion) {
          return {
            success: false,
            error: `Version conflict: expected ${request.expected_version}, found ${currentVersion}`,
            current_version: currentVersion,
            conflict_detected: true,
            http_status: 409
          };
        }
      }

      // STEP 3: Apply governance validation
      const governance = TaskGovernance.governTaskUpdate(currentTask, request);
      if (!governance.allowed) {
        const http_status = this.categorizeViolation(governance.errors);
        return {
          success: false,
          error: 'Update rejected by governance rules',
          violations: governance.errors,
          current_version: currentVersion,
          http_status
        };
      }

      // STEP 4: Prepare updated task with incremented version
      let updatedTask: VersionedTask = {
        ...currentTask,
        ...governance.sanitizedUpdates,
        state_version: currentVersion + 1,
        updated_at: new Date().toISOString()
      };

      // Budget counters (atomic with version increment)
      if (governance.sanitizedUpdates.status === "retrying") {
        updatedTask.retry_count = (updatedTask.retry_count || 0) + 1;
      }
      if (currentTask.type === "fix" && governance.sanitizedUpdates.status === "running") {
        updatedTask.fix_attempts = (updatedTask.fix_attempts || 0) + 1;
      }

      // DLQ check (atomic with version increment)
      if (TaskGovernance.shouldMoveToDLQ(updatedTask)) {
        updatedTask.status = "hard_failed";
        updatedTask.dlq_moved_at = new Date().toISOString();
      }

      // STEP 5: ATOMIC WRITE with version validation
      const writeSuccess = await writeTaskWithVersion(updatedTask);
      
      if (!writeSuccess) {
        return {
          success: false,
          error: 'Write conflict - task was modified by another process',
          current_version: currentVersion,
          conflict_detected: true,
          http_status: 409
        };
      }

      return {
        success: true,
        task: updatedTask,
        current_version: currentVersion + 1
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
   * BATCH VERSIONED COMMIT
   */
  static async commitBatchWithVersioning(
    getCurrentTask: (task_id: string) => Promise<VersionedTask | null>,
    writeTaskWithVersion: (task: VersionedTask) => Promise<boolean>,
    requests: VersionedUpdateRequest[]
  ): Promise<{ success: boolean; results: VersionedUpdateResult[] }> {
    const results: VersionedUpdateResult[] = [];
    
    // STEP 1: Validate all first (fail fast)
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

      const currentVersion = currentTask.state_version || 0;

      // Version check
      if (request.expected_version !== undefined) {
        if (request.expected_version !== currentVersion) {
          results.push({
            success: false,
            error: `Version conflict: expected ${request.expected_version}, found ${currentVersion}`,
            current_version: currentVersion,
            conflict_detected: true,
            http_status: 409
          });
          continue;
        }
      }

      // Governance check
      const governance = TaskGovernance.governTaskUpdate(currentTask, request);
      if (!governance.allowed) {
        const http_status = this.categorizeViolation(governance.errors);
        results.push({
          success: false,
          error: 'Update rejected by governance rules',
          violations: governance.errors,
          current_version: currentVersion,
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

    // STEP 2: All validations passed - execute writes
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      const currentTask = await getCurrentTask(request.task_id);
      
      if (!currentTask) {
        results[i] = {
          success: false,
          error: 'Task disappeared during batch',
          http_status: 404
        };
        continue;
      }

      const currentVersion = currentTask.state_version || 0;
      
      const governance = TaskGovernance.governTaskUpdate(currentTask, request);
      let updatedTask: VersionedTask = {
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

      const writeSuccess = await writeTaskWithVersion(updatedTask);
      
      if (!writeSuccess) {
        results[i] = {
          success: false,
          error: 'Write conflict during batch execution',
          current_version: currentVersion,
          conflict_detected: true,
          http_status: 409
        };
      } else {
        results[i] = { 
          success: true, 
          task: updatedTask,
          current_version: currentVersion + 1
        };
      }
    }

    return { success: true, results };
  }

  /**
   * MIGRATION: Add versioning to existing tasks
   */
  static async migrateTasksToVersioning(
    getAllTasks: () => Promise<any[]>,
    updateTask: (task: any) => Promise<void>
  ): Promise<{ migrated: number; failed: number }> {
    const tasks = await getAllTasks();
    let migrated = 0;
    let failed = 0;

    for (const task of tasks) {
      try {
        if (task.state_version === undefined) {
          task.state_version = 1;
          await updateTask(task);
          migrated++;
        }
      } catch (error) {
        console.error(`Failed to migrate task ${task.task_id}:`, error);
        failed++;
      }
    }

    return { migrated, failed };
  }

  /**
   * DETECT VERSION ANOMALIES
   */
  static async detectVersionAnomalies(
    getAllTasks: () => Promise<any[]>
  ): Promise<{ missing_version: string[]; version_gaps: string[] }> {
    const tasks = await getAllTasks();
    const missing_version: string[] = [];
    const version_gaps: string[] = [];

    for (const task of tasks) {
      if (task.state_version === undefined) {
        missing_version.push(task.task_id);
      }
    }

    return { missing_version, version_gaps };
  }

  /**
   * Categorize violations for HTTP status codes
   */
  private static categorizeViolation(errors: any[]): number {
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
}
