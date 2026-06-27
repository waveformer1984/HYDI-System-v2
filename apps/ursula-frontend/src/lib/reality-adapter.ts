// REALITY ADAPTER INTERFACE - Bridging deterministic ledger with physical world
// Abstracts the messy physical world so the ledger remains pure

import { createHash } from 'crypto';

export type ExecutionStatus = 'ACKNOWLEDGED' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';

export interface ExecutionReceipt {
  uek: string;                // Universal Execution Key (deterministic)
  status: ExecutionStatus;
  proof: string;              // Raw hardware response/buffer/API body
  timestamp: number;
  retryCount: number;
  adapterId: string;          // Which adapter handled this
  metadata?: any;             // Additional adapter-specific data
}

export interface RealityAdapter {
  // Unique identifier for this adapter instance
  readonly adapterId: string;

  // PHASE 2: The Attempt - Send command to physical world
  send(command: any, uek: string): Promise<ExecutionReceipt>;

  // THE FORENSIC INQUIRY: Ask the world "Did I already do this?"
  inquire(uek: string): Promise<ExecutionReceipt | null>;

  // PRE-FLIGHT CHECK: Current physical state
  getCurrentState?(): Promise<any>;
}

// Base class for reality adapters with common functionality
export abstract class BaseRealityAdapter implements RealityAdapter {
  readonly adapterId: string;
  protected receiptCache: Map<string, ExecutionReceipt> = new Map();

  constructor(adapterId: string) {
    this.adapterId = adapterId;
  }

  abstract send(command: any, uek: string): Promise<ExecutionReceipt>;
  abstract inquire(uek: string): Promise<ExecutionReceipt | null>;

  // Cache receipts for quick inquiry
  protected cacheReceipt(receipt: ExecutionReceipt): void {
    this.receiptCache.set(receipt.uek, receipt);
  }

  // Generate deterministic UEK from task and sequence
  generateUEK(taskId: string, sequenceNumber: number): string {
    const data = `${taskId}:${sequenceNumber}:${this.adapterId}`;
    return createHash('sha256').update(data).digest('hex').substring(0, 16);
  }
}
