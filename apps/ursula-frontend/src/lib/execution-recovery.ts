/**
 * EXECUTION RECOVERY - Handle timeouts and stalled tasks
 * What happens when HYDI says APPROVED but Ursula never responds
 */

import { UDPTaskCore } from '@/types/task';
import { UrsulaBridge } from './ursula-bridge';
import { getHealingService } from './healing/claude-healing';

export interface RecoveryWorker {
  checkStalledTasks(): Promise<StalledTask[]>;
  handleStalledTask(task: UDPTaskCore): Promise<RecoveryResult>;
}

export interface StalledTask {
  task: UDPTaskCore;
  stallReason: 'execution_timeout' | 'payment_timeout' | 'bridge_failure';
  stalledAt: number;
  lastActivity: number;
}

export interface RecoveryResult {
  success: boolean;
  action: 'retried' | 'failed' | 'refunded' | 'escalated';
  details: string;
  updatedTask?: UDPTaskCore;
}

export class ExecutionRecovery implements RecoveryWorker {
  private static readonly EXECUTION_TIMEOUT = 30 * 1000; // 30 seconds
  private static readonly PAYMENT_TIMEOUT = 60 * 1000; // 1 minute
  private static readonly STALL_THRESHOLD = 5 * 60 * 1000; // 5 minutes

  /**
   * Find tasks that are stalled in EXECUTING or pending payment states
   */
  async checkStalledTasks(): Promise<StalledTask[]> {
    const stalledTasks: StalledTask[] = [];
    const now = Date.now();

    // In production, this would query the database for tasks in problematic states
    // For now, simplified logic

    const tasks = await this.getTasksInExecutionStates();

    for (const task of tasks) {
      const stallReason = this.determineStallReason(task, now);
      if (stallReason) {
        stalledTasks.push({
          task,
          stallReason,
          stalledAt: now,
          lastActivity: task.updated_at ? new Date(task.updated_at).getTime() : 0,
        });
      }
    }

    return stalledTasks;
  }

  /**
   * Handle a stalled task with appropriate recovery action
   */
  async handleStalledTask(task: UDPTaskCore): Promise<RecoveryResult> {
    const stallReason = this.determineStallReason(task, Date.now());

    if (!stallReason) {
      return {
        success: false,
        action: 'failed',
        details: 'Task is not actually stalled',
      };
    }

    console.log(`[RECOVERY] Handling stalled task ${task.task_id}: ${stallReason}`);

    switch (stallReason) {
      case 'execution_timeout':
        return await this.handleExecutionTimeout(task);

      case 'payment_timeout':
        return await this.handlePaymentTimeout(task);

      case 'bridge_failure':
        return await this.handleBridgeFailure(task);

      default:
        return {
          success: false,
          action: 'failed',
          details: `Unknown stall reason: ${stallReason}`,
        };
    }
  }

  /**
   * Handle execution timeout - check Ursula status and decide action
   */
  private async handleExecutionTimeout(task: UDPTaskCore): Promise<RecoveryResult> {
    if (!task.ursula_execution_id) {
      return {
        success: false,
        action: 'escalated',
        details: 'Task marked as running but no execution ID - requires manual review',
      };
    }

    try {
      // Check Ursula execution status
      const status = await UrsulaBridge.getExecutionStatus(task.ursula_execution_id);

      if (status.status === 'COMPLETED' || status.status === 'FAILED') {
        // Task actually completed/failed but HYDI wasn't updated
        return await this.syncTaskState(task, status);
      } else {
        // Task is still running or unknown - mark as stalled
        return await this.markTaskStalled(task, 'execution_timeout' as const);
      }
    } catch (error) {
      console.error(`[RECOVERY] Failed to check execution status for ${task.task_id}:`, error);
      return await this.markTaskStalled(task, 'bridge_failure' as const);
    }
  }

  /**
   * Handle payment timeout - check Stripe and reconcile
   */
  private async handlePaymentTimeout(task: UDPTaskCore): Promise<RecoveryResult> {
    if (!task.ursula_payment_intent_id) {
      return await this.markTaskStalled(task, 'payment_timeout' as const);
    }

    try {
      // In production, would check Stripe payment intent status
      // For now, assume payment failed if stuck this long
      return await this.markTaskFailed(task, 'Payment timeout - likely failed');
    } catch (error) {
      console.error(`[RECOVERY] Failed to check payment status for ${task.task_id}:`, error);
      return await this.markTaskStalled(task, 'payment_timeout');
    }
  }

  /**
   * Handle bridge failure - retry with backoff
   */
  private async handleBridgeFailure(task: UDPTaskCore): Promise<RecoveryResult> {
    const retryCount = task.retry_count || 0;

    if (retryCount >= 3) {
      // Ask Claude for a corrected strategy before giving up
      getHealingService().diagnoseAndCorrect({
        taskId: task.task_id,
        taskType: task.type,
        error: 'Bridge failure after max retries',
        resultStatus: 'failed_terminal',
      }).then(heal => {
        if (heal) console.log(`[RECOVERY] Claude correction for ${task.task_id}: ${heal.root_cause}`);
      }).catch(() => {});
      return await this.markTaskFailed(task, 'Bridge failure after max retries');
    }

    // Increment retry count and try again
    const updatedTask: UDPTaskCore = {
      ...task,
      status: 'pending' as const,
      retry_count: retryCount + 1,
      updated_at: new Date().toISOString(),
    };

    // Would update task in storage here
    console.log(`[RECOVERY] Retrying task ${task.task_id} (attempt ${retryCount + 1})`);

    return {
      success: true,
      action: 'retried',
      details: `Task retry scheduled (attempt ${retryCount + 1})`,
      updatedTask,
    };
  }

  /**
   * Sync task state with actual execution status
   */
  private async syncTaskState(task: UDPTaskCore, status: any): Promise<RecoveryResult> {
    const updatedTask: UDPTaskCore = {
      ...task,
      status: status.status === 'COMPLETED' ? 'complete' : 'failed',
      result: status.result,
      error: status.error,
      billing_status: status.status === 'COMPLETED' ? 'paid' : 'failed',
      updated_at: new Date().toISOString(),
    };

    return {
      success: true,
      action: 'retried', // Actually "synced" but using existing action type
      details: `Task state synchronized with Ursula status: ${status.status}`,
      updatedTask,
    };
  }

  /**
   * Mark task as stalled
   */
  private async markTaskStalled(task: UDPTaskCore, reason: string): Promise<RecoveryResult> {
    const updatedTask: UDPTaskCore = {
      ...task,
      status: 'failed' as const,
      error: `Stalled: ${reason}`,
      billing_status: 'failed' as const,
      updated_at: new Date().toISOString(),
    };

    return {
      success: true,
      action: 'failed',
      details: `Task marked as failed due to: ${reason}`,
      updatedTask,
    };
  }

  /**
   * Mark task as failed
   */
  private async markTaskFailed(task: UDPTaskCore, reason: string): Promise<RecoveryResult> {
    const updatedTask: UDPTaskCore = {
      ...task,
      status: 'failed' as const,
      error: reason,
      billing_status: 'failed' as const,
      updated_at: new Date().toISOString(),
    };

    return {
      success: true,
      action: 'failed',
      details: `Task marked as failed: ${reason}`,
      updatedTask,
    };
  }

  /**
   * Determine why a task is stalled
   */
  private determineStallReason(task: UDPTaskCore, now: number): 'execution_timeout' | 'payment_timeout' | 'bridge_failure' | null {
    const lastUpdate = task.updated_at ? new Date(task.updated_at).getTime() : 0;
    const timeSinceUpdate = now - lastUpdate;

    if (timeSinceUpdate < ExecutionRecovery.STALL_THRESHOLD) {
      return null; // Not stalled yet
    }

    if (task.status === 'running' && task.ursula_execution_id) {
      return 'execution_timeout';
    }

    if (task.billing_status === 'pending' && task.ursula_payment_intent_id) {
      return 'payment_timeout';
    }

    if (task.status === 'running' && !task.ursula_execution_id) {
      return 'bridge_failure';
    }

    return 'execution_timeout'; // Default
  }

  /**
   * Get tasks in execution states (simplified)
   */
  private async getTasksInExecutionStates(): Promise<UDPTaskCore[]> {
    // In production, would query database for tasks in running/pending states
    // For now, return empty array - would be implemented with actual storage
    return [];
  }
}

/**
 * Recovery worker that runs periodically
 */
export class RecoveryWorkerService {
  private recovery: ExecutionRecovery;
  private interval: NodeJS.Timeout | null = null;

  constructor() {
    this.recovery = new ExecutionRecovery();
  }

  start(intervalMs: number = 60 * 1000): void {
    if (this.interval) {
      console.log('[RECOVERY] Worker already running');
      return;
    }

    console.log('[RECOVERY] Starting recovery worker');

    this.interval = setInterval(async () => {
      try {
        await this.runRecoveryCycle();
      } catch (error) {
        console.error('[RECOVERY] Recovery cycle failed:', error);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[RECOVERY] Worker stopped');
    }
  }

  private async runRecoveryCycle(): Promise<void> {
    console.log('[RECOVERY] Running recovery cycle');

    const stalledTasks = await this.recovery.checkStalledTasks();

    if (stalledTasks.length === 0) {
      console.log('[RECOVERY] No stalled tasks found');
      return;
    }

    console.log(`[RECOVERY] Found ${stalledTasks.length} stalled tasks`);

    for (const stalledTask of stalledTasks) {
      const result = await this.recovery.handleStalledTask(stalledTask.task);

      console.log(`[RECOVERY] Task ${stalledTask.task.task_id}: ${result.action} - ${result.details}`);

      // In production, would update task in storage with result.updatedTask
    }
  }
}
