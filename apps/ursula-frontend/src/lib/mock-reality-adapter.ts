// MOCK REALITY ADAPTER - Test bench with simulated network conditions
// Simulates 500ms latency and 10% packet loss

import { BaseRealityAdapter, ExecutionReceipt, ExecutionStatus } from './reality-adapter.js';
import { createHash } from 'crypto';

export interface MockConfig {
  latencyMs: number;
  packetLossRate: number;
  failureRate: number;
  duplicateAckRate: number;
}

export class MockRealityAdapter extends BaseRealityAdapter {
  private config: MockConfig;
  private commandLog: Map<string, any> = new Map();
  private physicalState: any = {};

  constructor(adapterId: string, config: Partial<MockConfig> = {}) {
    super(adapterId);
    this.config = {
      latencyMs: 500,
      packetLossRate: 0.1,
      failureRate: 0.05,
      duplicateAckRate: 0.02,
      ...config
    };
  }

  async send(command: any, uek: string): Promise<ExecutionReceipt> {
    console.log(`   [${this.adapterId}] Sending command with UEK: ${uek}`);

    // Simulate network latency
    await this.simulateLatency();

    // Simulate packet loss
    if (Math.random() < this.config.packetLossRate) {
      console.log(`   [${this.adapterId}] ⚠️  Packet loss for UEK: ${uek}`);
      throw new Error('Network packet lost');
    }

    // Check for duplicate command (idempotency check)
    if (this.commandLog.has(uek)) {
      console.log(`   [${this.adapterId}] ♻️  Duplicate command detected for UEK: ${uek}`);
      const existingReceipt = this.receiptCache.get(uek);
      if (existingReceipt) {
        return { ...existingReceipt, retryCount: existingReceipt.retryCount + 1 };
      }
    }

    // Log the command
    this.commandLog.set(uek, { ...command, sentAt: Date.now() });

    // Simulate execution
    const status = await this.simulateExecution(command);
    const receipt: ExecutionReceipt = {
      uek,
      status,
      proof: this.generateProof(command, status),
      timestamp: Date.now(),
      retryCount: 0,
      adapterId: this.adapterId,
      metadata: {
        simulatedLatency: this.config.latencyMs,
        commandType: command.type
      }
    };

    // Cache receipt
    this.cacheReceipt(receipt);

    // Update physical state
    this.updatePhysicalState(command, status);

    console.log(`   [${this.adapterId}] ✅ Command completed with status: ${status}`);

    // Simulate duplicate ACK
    if (Math.random() < this.config.duplicateAckRate) {
      setTimeout(() => {
        console.log(`   [${this.adapterId}] 📨 Sending duplicate ACK for UEK: ${uek}`);
      }, 100);
    }

    return receipt;
  }

  async inquire(uek: string): Promise<ExecutionReceipt | null> {
    // First check cache
    const cached = this.receiptCache.get(uek);
    if (cached) {
      console.log(`   [${this.adapterId}] 📋 Found cached receipt for UEK: ${uek}`);
      return cached;
    }

    // Simulate inquiry latency
    await this.simulateLatency();

    // Check command log
    const command = this.commandLog.get(uek);
    if (!command) {
      console.log(`   [${this.adapterId}] ❓ No record of UEK: ${uek}`);
      return null;
    }

    console.log(`   [${this.adapterId}] 🔍 Found command in log for UEK: ${uek}`);

    // Reconstruct receipt from log
    const receipt: ExecutionReceipt = {
      uek,
      status: 'COMPLETED', // Assume completed if in log
      proof: this.generateProof(command, 'COMPLETED'),
      timestamp: command.sentAt,
      retryCount: 0,
      adapterId: this.adapterId
    };

    return receipt;
  }

  async getCurrentState(): Promise<any> {
    return {
      ...this.physicalState,
      adapterId: this.adapterId,
      commandsProcessed: this.commandLog.size,
      lastActivity: Math.max(...Array.from(this.commandLog.values()).map(c => c.sentAt || 0))
    };
  }

  private async simulateLatency(): Promise<void> {
    const actualLatency = this.config.latencyMs * (0.5 + Math.random());
    await new Promise(resolve => setTimeout(resolve, actualLatency));
  }

  private async simulateExecution(command: any): Promise<ExecutionStatus> {
    // Simulate hardware failure
    if (Math.random() < this.config.failureRate) {
      return 'FAILED';
    }

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    // Return status based on command type
    switch (command.type) {
      case 'START_PRINT':
        return 'COMPLETED';
      case 'STOP_PRINT':
        return 'COMPLETED';
      case 'QUERY_STATUS':
        return 'ACKNOWLEDGED';
      default:
        return 'UNKNOWN';
    }
  }

  private generateProof(command: any, status: ExecutionStatus): string {
    const proofData = {
      command,
      status,
      timestamp: Date.now(),
      adapterId: this.adapterId,
      nonce: Math.random()
    };
    return createHash('sha256').update(JSON.stringify(proofData)).digest('hex');
  }

  private updatePhysicalState(command: any, status: ExecutionStatus): void {
    switch (command.type) {
      case 'START_PRINT':
        this.physicalState.printerStatus = status === 'COMPLETED' ? 'RUNNING' : 'ERROR';
        this.physicalState.currentJob = command.jobId;
        break;
      case 'STOP_PRINT':
        this.physicalState.printerStatus = 'IDLE';
        this.physicalState.currentJob = null;
        break;
      case 'QUERY_STATUS':
        // No state change for query
        break;
    }
  }

  // Utility methods for testing
  getCommandLog(): Map<string, any> {
    return new Map(this.commandLog);
  }

  clearLog(): void {
    this.commandLog.clear();
    this.receiptCache.clear();
    this.physicalState = {};
  }

  updateConfig(newConfig: Partial<MockConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}
