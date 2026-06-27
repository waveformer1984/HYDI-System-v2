// PHASE 3 PROCESSOR - Event-sourced coordination with execution confirmation
// Implements the 3-phase handshake: Intent Commit → Execution Attempt → External Confirmation

import { EventSourcedLedger, TaskEvent } from './event-sourced-ledger.js';
import { RealityAdapter, ExecutionReceipt, ExecutionStatus } from './reality-adapter.js';
import { PureTaskStateReducer } from './pure-state-reducer.js';

export interface ProcessingMetrics {
  reconciliationLatencyMs: number;
  phase1TimeMs: number;
  phase2TimeMs: number;
  phase3TimeMs: number;
  totalRetries: number;
}

export interface ProcessingResult {
  taskId: string;
  uek: string;
  success: boolean;
  metrics: ProcessingMetrics;
  finalReceipt?: ExecutionReceipt;
  error?: string;
}

export class Phase3TaskProcessor {
  private ledger: EventSourcedLedger;
  private adapter: RealityAdapter;
  private activeTasks: Map<string, ProcessingMetrics> = new Map();
  private isReplayMode: boolean = false;

  constructor(ledger: EventSourcedLedger, adapter: RealityAdapter) {
    this.ledger = ledger;
    this.adapter = adapter;
  }

  /**
   * Set replay mode to prevent triggering physical actions during replay
   */
  setReplayMode(enabled: boolean): void {
    this.isReplayMode = enabled;
    if (enabled) {
      console.log('   🛡️  Processor in REPLAY mode - using ForensicShadowAdapter');
    } else {
      console.log('   ⚡ Processor in LIVE mode - using physical adapter');
    }
  }

  /**
   * Process a task using the 3-phase handshake
   */
  async processTask(taskId: string, command: any): Promise<ProcessingResult> {
    const startTime = Date.now();
    const metrics: ProcessingMetrics = {
      reconciliationLatencyMs: 0,
      phase1TimeMs: 0,
      phase2TimeMs: 0,
      phase3TimeMs: 0,
      totalRetries: 0
    };

    try {
      // Get current sequence number for UEK generation
      const events = await this.ledger.replayEvents();
      const nextSequence = events.length > 0 ? events[events.length - 1].sequence_number + 1 : 1;
      const uek = `${taskId}_${nextSequence}`; // Simplified UEK generation

      console.log(`\n   📋 Processing task ${taskId} with UEK: ${uek}`);

      // Phase 1: Intent Commit
      const phase1Start = Date.now();
      await this.phase1_IntentCommit(taskId, command, uek);
      metrics.phase1TimeMs = Date.now() - phase1Start;

      // Phase 2: Execution Attempt
      const phase2Start = Date.now();
      const receipt = await this.phase2_ExecutionAttempt(taskId, command, uek, metrics);
      metrics.phase2TimeMs = Date.now() - phase2Start;

      // Phase 3: External Confirmation
      const phase3Start = Date.now();
      await this.phase3_ExternalConfirmation(taskId, receipt, metrics);
      metrics.phase3TimeMs = Date.now() - phase3Start;

      metrics.reconciliationLatencyMs = Date.now() - startTime;

      return {
        taskId,
        uek,
        success: true,
        metrics,
        finalReceipt: receipt
      };

    } catch (error) {
      metrics.reconciliationLatencyMs = Date.now() - startTime;

      return {
        taskId,
        uek: '',
        success: false,
        metrics,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Phase 1: Intent Commit - Write to ledger before touching hardware
   */
  private async phase1_IntentCommit(taskId: string, command: any, uek: string): Promise<void> {
    console.log(`   📍 Phase 1: Intent Commit`);

    // Pre-flight inquiry - check if already executed
    if (!this.isReplayMode) {
      const existingReceipt = await this.adapter.inquire(uek);
      if (existingReceipt) {
        console.log(`   ⚠️  Task already executed (UEK: ${uek}), skipping...`);
        throw new Error('Task already executed');
      }
    }

    // Write intent to ledger
    await this.ledger.appendEvent('task_updated', taskId, {
      command,
      uek,
      adapterId: this.adapter.adapterId,
      phase: 'INTENT_COMMIT',
      status: 'start_requested'
    });

    console.log(`   ✅ Intent committed to ledger`);
  }

  /**
   * Phase 2: Execution Attempt - Send command to physical world
   */
  private async phase2_ExecutionAttempt(
    taskId: string,
    command: any,
    uek: string,
    metrics: ProcessingMetrics
  ): Promise<ExecutionReceipt> {
    console.log(`   ⚡ Phase 2: Execution Attempt`);

    if (this.isReplayMode) {
      // In replay mode, check for existing receipt instead of sending
      const existingReceipt = await this.adapter.inquire(uek);
      if (!existingReceipt) {
        throw new Error('No receipt found during replay - inconsistent state');
      }
      console.log(`   📜 Replay: Found existing receipt`);
      return existingReceipt;
    }

    // Live execution
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        const receipt = await this.adapter.send(command, uek);
        console.log(`   ✅ Command executed successfully`);
        return receipt;
      } catch (error) {
        retryCount++;
        metrics.totalRetries++;
        console.log(`   ⚠️  Execution attempt ${retryCount} failed: ${error}`);

        if (retryCount >= maxRetries) {
          throw new Error(`Execution failed after ${maxRetries} attempts`);
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
      }
    }

    throw new Error('Execution failed');
  }

  /**
   * Phase 3: External Confirmation - Write completion with proof
   */
  private async phase3_ExternalConfirmation(
    taskId: string,
    receipt: ExecutionReceipt,
    metrics: ProcessingMetrics
  ): Promise<void> {
    console.log(`   🔍 Phase 3: External Confirmation`);

    // Validate receipt
    if (!receipt.uek || !receipt.proof) {
      throw new Error('Invalid receipt: missing UEK or proof');
    }

    // Determine event type based on status
    const eventType = receipt.status === 'COMPLETED' ? 'task_completed' : 'task_failed';

    // Write completion event with embedded proof
    await this.ledger.appendEvent(eventType, taskId, {
      uek: receipt.uek,
      status: receipt.status,
      proof: receipt.proof,
      timestamp: receipt.timestamp,
      retryCount: receipt.retryCount,
      adapterId: receipt.adapterId,
      reconciliationLatencyMs: metrics.reconciliationLatencyMs,
      phase: 'EXTERNAL_CONFIRMATION'
    });

    console.log(`   ✅ Confirmation written to ledger with proof`);
  }

  /**
   * Process multiple tasks concurrently
   */
  async processBatch(tasks: Array<{ taskId: string; command: any }>): Promise<ProcessingResult[]> {
    console.log(`\n 🔄 Processing batch of ${tasks.length} tasks`);

    const results = await Promise.allSettled(
      tasks.map(task => this.processTask(task.taskId, task.command))
    );

    return results.map(result =>
      result.status === 'fulfilled' ? result.value : {
        taskId: 'unknown',
        uek: '',
        success: false,
        metrics: {
          reconciliationLatencyMs: 0,
          phase1TimeMs: 0,
          phase2TimeMs: 0,
          phase3TimeMs: 0,
          totalRetries: 0
        },
        error: result.reason
      }
    );
  }

  /**
   * Get processing statistics
   */
  getStatistics(): {
    activeTasks: number;
    totalProcessed: number;
    averageLatency: number;
    replayMode: boolean;
  } {
    const activeTasks = this.activeTasks.size;
    const totalProcessed = this.activeTasks.size; // Simplified
    const averageLatency = Array.from(this.activeTasks.values())
      .reduce((sum, m) => sum + m.reconciliationLatencyMs, 0) / Math.max(activeTasks, 1);

    return {
      activeTasks,
      totalProcessed,
      averageLatency,
      replayMode: this.isReplayMode
    };
  }
}
