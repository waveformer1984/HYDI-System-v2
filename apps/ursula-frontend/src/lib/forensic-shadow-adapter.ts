// FORENSIC SHADOW ADAPTER - Read-only replay that doesn't trigger physical actions
// Ensures replay is a "read-only" operation on the universe

import { BaseRealityAdapter, ExecutionReceipt } from './reality-adapter.js';
import { EventSourcedLedger, TaskEvent } from './event-sourced-ledger.js';

export class ForensicShadowAdapter extends BaseRealityAdapter {
  private ledger: EventSourcedLedger;
  private receiptIndex: Map<string, ExecutionReceipt> = new Map();

  constructor(ledger: EventSourcedLedger, wrappedAdapterId: string) {
    super(`shadow_${wrappedAdapterId}`);
    this.ledger = ledger;
    this.buildReceiptIndex();
  }

  /**
   * Build index of receipts from ledger for fast lookup
   */
  private async buildReceiptIndex(): Promise<void> {
    console.log(`   [${this.adapterId}] 🔍 Building receipt index from ledger...`);

    const events = await this.ledger.replayEvents();

    for (const event of events) {
      if (event.event_type === 'task_completed' || event.event_type === 'task_failed') {
        const uek = event.data?.uek;
        if (uek) {
          const receipt: ExecutionReceipt = {
            uek,
            status: event.data?.status || 'UNKNOWN',
            proof: event.data?.proof || '',
            timestamp: event.data?.timestamp || event.timestamp,
            retryCount: event.data?.retryCount || 0,
            adapterId: event.data?.adapterId || 'unknown'
          };

          this.receiptIndex.set(uek, receipt);
        }
      }
    }

    console.log(`   [${this.adapterId}] 📊 Indexed ${this.receiptIndex.size} receipts`);
  }

  /**
   * send() in shadow mode - NEVER sends commands
   */
  async send(command: any, uek: string): Promise<ExecutionReceipt> {
    console.log(`   [${this.adapterId}] 🚫 Shadow mode: refusing to send command for UEK: ${uek}`);

    // Check if we already have a receipt
    const existing = this.receiptIndex.get(uek);
    if (existing) {
      console.log(`   [${this.adapterId}] 📋 Found existing receipt in ledger`);
      return existing;
    }

    // In replay, if we don't have a receipt, something is wrong
    throw new Error(`Shadow adapter: No receipt found for UEK ${uek} in replay`);
  }

  /**
   * inquire() - Check receipt index
   */
  async inquire(uek: string): Promise<ExecutionReceipt | null> {
    const receipt = this.receiptIndex.get(uek);

    if (receipt) {
      console.log(`   [${this.adapterId}] 📋 Found receipt for UEK: ${uek}`);
    } else {
      console.log(`   [${this.adapterId}] ❓ No receipt found for UEK: ${uek}`);
    }

    return receipt || null;
  }

  /**
   * Update index with new events (for live replay scenarios)
   */
  async updateIndex(): Promise<void> {
    this.receiptIndex.clear();
    await this.buildReceiptIndex();
  }

  /**
   * Verify receipt consistency
   */
  async verifyReceiptConsistency(): Promise<{
    consistent: boolean;
    missingReceipts: string[];
    orphanedReceipts: string[];
  }> {
    const events = await this.ledger.replayEvents();
    const taskEventsMap = new Map<string, TaskEvent[]>();

    // Group events by task
    for (const event of events) {
      if (!taskEventsMap.has(event.task_id)) {
        taskEventsMap.set(event.task_id, []);
      }
      taskEventsMap.get(event.task_id)!.push(event);
    }

    const missingReceipts: string[] = [];
    const orphanedReceipts: string[] = [];

    // Check each task for receipt consistency
    for (const [taskId, taskEventList] of taskEventsMap.entries()) {
      const hasStartRequested = taskEventList.some(e =>
        e.event_type === 'task_updated' && e.data?.status === 'start_requested'
      );
      const hasCompletion = taskEventList.some(e =>
        e.event_type === 'task_completed' || e.event_type === 'task_failed'
      );

      if (hasStartRequested && !hasCompletion) {
        missingReceipts.push(taskId);
      }

      if (hasCompletion && !hasStartRequested) {
        orphanedReceipts.push(taskId);
      }
    }

    return {
      consistent: missingReceipts.length === 0 && orphanedReceipts.length === 0,
      missingReceipts,
      orphanedReceipts
    };
  }

  /**
   * Generate forensic report
   */
  async generateForensicReport(): Promise<{
    totalReceipts: number;
    receiptsByStatus: Record<string, number>;
    receiptsByAdapter: Record<string, number>;
    averageRetryCount: number;
    consistencyCheck: any;
  }> {
    const receipts = Array.from(this.receiptIndex.values());
    const receiptsByStatus: Record<string, number> = {};
    const receiptsByAdapter: Record<string, number> = {};
    let totalRetryCount = 0;

    for (const receipt of receipts) {
      receiptsByStatus[receipt.status] = (receiptsByStatus[receipt.status] || 0) + 1;
      receiptsByAdapter[receipt.adapterId] = (receiptsByAdapter[receipt.adapterId] || 0) + 1;
      totalRetryCount += receipt.retryCount;
    }

    const consistencyCheck = await this.verifyReceiptConsistency();

    return {
      totalReceipts: receipts.length,
      receiptsByStatus,
      receiptsByAdapter,
      averageRetryCount: receipts.length > 0 ? totalRetryCount / receipts.length : 0,
      consistencyCheck
    };
  }
}
