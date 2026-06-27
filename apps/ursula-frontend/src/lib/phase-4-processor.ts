// PHASE 4 PROCESSOR - Execution Verification Layer
// 4 phases: Intent → Execute → Receipt → Verification

import { EventSourcedLedger } from './event-sourced-ledger.js';
import { RealityAdapter, ExecutionReceipt } from './reality-adapter.js';
import { BaseRealityVerifier, VerificationRequest, VerificationResult } from './reality-verifier.js';
import { RealityStateStore } from './reality-state-store.js';

export interface Phase4Metrics {
  phase1TimeMs: number;
  phase2TimeMs: number;
  phase3TimeMs: number;
  phase4TimeMs: number;
  totalLatencyMs: number;
  verificationPassed: boolean;
  compensationTriggered: boolean;
}

export interface Phase4Result {
  taskId: string;
  executionId: string;
  success: boolean;
  verified: boolean;
  metrics: Phase4Metrics;
  verificationResult?: VerificationResult;
  error?: string;
}

export class Phase4TaskProcessor {
  private ledger: EventSourcedLedger;
  private adapter: RealityAdapter;
  private verifier: BaseRealityVerifier;
  private stateStore: RealityStateStore;
  private isReplayMode: boolean = false;

  constructor(
    ledger: EventSourcedLedger,
    adapter: RealityAdapter,
    verifier: BaseRealityVerifier,
    stateStore: RealityStateStore
  ) {
    this.ledger = ledger;
    this.adapter = adapter;
    this.verifier = verifier;
    this.stateStore = stateStore;
  }

  /**
   * Set replay mode - prevents physical execution
   */
  setReplayMode(enabled: boolean): void {
    this.isReplayMode = enabled;
    console.log(`   🛡️  Processor in ${enabled ? 'REPLAY' : 'LIVE'} mode`);
  }

  /**
   * Process task with 4-phase verification
   */
  async processTask(taskId: string, command: any, expectedState: any): Promise<Phase4Result> {
    const startTime = Date.now();
    const metrics: Phase4Metrics = {
      phase1TimeMs: 0,
      phase2TimeMs: 0,
      phase3TimeMs: 0,
      phase4TimeMs: 0,
      totalLatencyMs: 0,
      verificationPassed: false,
      compensationTriggered: false
    };

    const executionId = `${taskId}_${Date.now()}`;

    try {
      console.log(`\n   📋 Phase 4 Processing: ${taskId}`);
      console.log(`   Execution ID: ${executionId}`);

      // Phase 1: Intent Commit
      const phase1Start = Date.now();
      const uek = await this.phase1_IntentCommit(taskId, command, executionId);
      metrics.phase1TimeMs = Date.now() - phase1Start;

      // Phase 2: Execution Attempt
      const phase2Start = Date.now();
      const receipt = await this.phase2_ExecutionAttempt(taskId, command, uek, executionId);
      metrics.phase2TimeMs = Date.now() - phase2Start;

      // Phase 3: Receipt Acknowledgment
      const phase3Start = Date.now();
      await this.phase3_ReceiptAcknowledgment(taskId, receipt, executionId);
      metrics.phase3TimeMs = Date.now() - phase3Start;

      // Phase 4: Independent Verification
      const phase4Start = Date.now();
      const verificationResult = await this.phase4_Verification(
        taskId,
        uek,
        expectedState,
        receipt,
        executionId
      );
      metrics.phase4TimeMs = Date.now() - phase4Start;
      metrics.verificationPassed = verificationResult.verified;

      // Store verification result
      await this.stateStore.storeVerification(verificationResult);

      // Handle verification failure
      if (!verificationResult.verified) {
        await this.handleVerificationFailure(taskId, verificationResult, executionId);
        metrics.compensationTriggered = true;
      }

      metrics.totalLatencyMs = Date.now() - startTime;

      return {
        taskId,
        executionId,
        success: true,
        verified: verificationResult.verified,
        metrics,
        verificationResult
      };

    } catch (error) {
      metrics.totalLatencyMs = Date.now() - startTime;

      return {
        taskId,
        executionId,
        success: false,
        verified: false,
        metrics,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Phase 1: Intent Commit - Write to ledger
   */
  private async phase1_IntentCommit(
    taskId: string,
    command: any,
    executionId: string
  ): Promise<string> {
    console.log(`   📍 Phase 1: Intent Commit`);

    // Generate UEK
    const events = await this.ledger.replayEvents();
    const nextSequence = events.length > 0 ? events[events.length - 1].sequence_number + 1 : 1;
    const uek = `${taskId}_${nextSequence}`;

    // Write intent event
    await this.ledger.appendEvent('task_updated', taskId, {
      command,
      executionId,
      uek,
      phase: 'INTENT_COMMIT',
      status: 'execution_requested'
    });

    console.log(`   ✅ Intent committed (UEK: ${uek})`);
    return uek;
  }

  /**
   * Phase 2: Execution Attempt - Send to adapter
   */
  private async phase2_ExecutionAttempt(
    taskId: string,
    command: any,
    uek: string,
    executionId: string
  ): Promise<ExecutionReceipt> {
    console.log(`   ⚡ Phase 2: Execution Attempt`);

    if (this.isReplayMode) {
      // In replay mode, check for existing receipt
      const existingReceipt = await this.adapter.inquire(uek);
      if (!existingReceipt) {
        throw new Error('No receipt found during replay');
      }
      console.log(`   📜 Replay: Found existing receipt`);
      return existingReceipt;
    }

    // Live execution
    const receipt = await this.adapter.send(command, uek);
    console.log(`   ✅ Command executed`);
    return receipt;
  }

  /**
   * Phase 3: Receipt Acknowledgment - Store adapter's claim
   */
  private async phase3_ReceiptAcknowledgment(
    taskId: string,
    receipt: ExecutionReceipt,
    executionId: string
  ): Promise<void> {
    console.log(`   📥 Phase 3: Receipt Acknowledgment`);

    // Store receipt as semi-trusted claim
    await this.ledger.appendEvent('task_updated', taskId, {
      executionId,
      uek: receipt.uek,
      receipt: {
        status: receipt.status,
        proof: receipt.proof,
        timestamp: receipt.timestamp,
        adapterId: receipt.adapterId
      },
      phase: 'RECEIPT_ACK',
      status: receipt.status === 'COMPLETED' ? 'claimed_completed' : 'claimed_failed'
    });

    console.log(`   ✅ Receipt acknowledged (${receipt.status})`);
  }

  /**
   * Phase 4: Independent Verification - Check reality
   */
  private async phase4_Verification(
    taskId: string,
    uek: string,
    expectedState: any,
    receipt: ExecutionReceipt,
    executionId: string
  ): Promise<VerificationResult> {
    console.log(`   🔍 Phase 4: Independent Verification`);

    // Create verification request
    const request: VerificationRequest = {
      executionId,
      uek,
      expectedState,
      receipt,
      verifierType: this.verifier.verifierType
    };

    // Perform independent verification
    const result = await this.verifier.verify(request);

    // Write verification event
    await this.ledger.appendEvent('task_updated', taskId, {
      executionId,
      uek,
      verification: {
        verified: result.verified,
        observedState: result.observedState,
        verifierId: result.verifierId,
        proof: result.verificationProof,
        mismatchReason: result.mismatchReason
      },
      phase: 'VERIFICATION_COMPLETE',
      status: result.verified ? 'verified_complete' : 'verification_failed'
    });

    return result;
  }

  /**
   * Handle verification failure with compensation
   */
  private async handleVerificationFailure(
    taskId: string,
    result: VerificationResult,
    executionId: string
  ): Promise<void> {
    console.log(`   ⚠️  Verification failed - triggering compensation`);
    console.log(`   Reason: ${result.mismatchReason}`);

    // Write compensation event
    await this.ledger.appendEvent('task_failed', taskId, {
      executionId,
      originalUEK: result.uek,
      failureReason: result.mismatchReason,
      expectedState: result.expectedState,
      observedState: result.observedState,
      compensationType: 'rollback_or_retry',
      status: 'verification_failed'
    });

    // Store in reality state for reconciliation
    await this.stateStore.reconcile(executionId, {
      expected: result.expectedState,
      observed: result.observedState,
      action: 'compensation_triggered'
    });
  }

  /**
   * Get verification statistics
   */
  async getVerificationStats(): Promise<{
    totalProcessed: number;
    verificationRate: number;
    compensationRate: number;
    averageLatency: number;
  }> {
    const stats = await this.stateStore.getStats();

    return {
      totalProcessed: stats.totalExecutions,
      verificationRate: stats.verificationRate,
      compensationRate: stats.failedVerifications / Math.max(stats.totalExecutions, 1),
      averageLatency: stats.averageVerificationTime
    };
  }

  /**
   * Find tasks needing reconciliation
   */
  async getTasksNeedingReconciliation(): Promise<Array<{
    executionId: string;
    mismatchReason: string;
    timestamp: number;
  }>> {
    const inconsistencies = await this.stateStore.findInconsistencies();

    return inconsistencies.map(inc => ({
      executionId: inc.executionId,
      mismatchReason: `Expected: ${JSON.stringify(inc.expected)}, Observed: ${JSON.stringify(inc.observed)}`,
      timestamp: 0 // Would need to be added to state
    }));
  }
}
