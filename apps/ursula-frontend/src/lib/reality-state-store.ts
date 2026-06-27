// REALITY STATE STORE - Tracks expected vs observed reality
// Closes the loop between intent and verification

import { RealityState, VerificationResult } from './reality-verifier.js';
import { createHash } from 'crypto';

export interface StateQuery {
  executionId?: string;
  uek?: string;
  verified?: boolean;
  verifier?: string;
  timeRange?: { start: number; end: number };
}

export interface StateStats {
  totalExecutions: number;
  verifiedExecutions: number;
  failedVerifications: number;
  verificationRate: number;
  averageVerificationTime: number;
  verifiersBreakdown: Record<string, number>;
}

export class RealityStateStore {
  private store: Map<string, RealityState> = new Map();
  private filePath: string;

  constructor(filePath: string = './data/reality-state.jsonl') {
    this.filePath = filePath;
  }

  /**
   * Store verification result
   */
  async storeVerification(result: VerificationResult): Promise<void> {
    const state: RealityState = {
      execution_id: result.executionId,
      expected: JSON.stringify(result.expectedState),
      observed: JSON.stringify(result.observedState),
      verified: result.verified,
      verifier: result.verifierId,
      timestamp: result.timestamp,
      proof_hash: result.verificationProof
    };

    // Store in memory
    this.store.set(result.executionId, state);

    // Persist to disk
    await this.appendToFile(state);

    console.log(`   [RealityStore] 📝 Stored verification for ${result.executionId}: ${result.verified ? 'VERIFIED' : 'FAILED'}`);
  }

  /**
   * Query reality states
   */
  async query(query: StateQuery): Promise<RealityState[]> {
    const results: RealityState[] = [];

    for (const [executionId, state] of this.store.entries()) {
      if (query.executionId && executionId !== query.executionId) continue;
      if (query.verified !== undefined && state.verified !== query.verified) continue;
      if (query.verifier && state.verifier !== query.verifier) continue;
      if (query.timeRange) {
        if (state.timestamp < query.timeRange.start || state.timestamp > query.timeRange.end) continue;
      }

      results.push(state);
    }

    return results;
  }

  /**
   * Get specific execution state
   */
  async getExecutionState(executionId: string): Promise<RealityState | null> {
    return this.store.get(executionId) || null;
  }

  /**
   * Check if execution was verified
   */
  async isVerified(executionId: string): Promise<boolean> {
    const state = await this.getExecutionState(executionId);
    return state?.verified || false;
  }

  /**
   * Get verification statistics
   */
  async getStats(timeRange?: { start: number; end: number }): Promise<StateStats> {
    const query = timeRange ? { timeRange } : {};
    const states = await this.query(query);

    const total = states.length;
    const verified = states.filter(s => s.verified).length;
    const failed = total - verified;

    const verifiersBreakdown: Record<string, number> = {};
    for (const state of states) {
      verifiersBreakdown[state.verifier] = (verifiersBreakdown[state.verifier] || 0) + 1;
    }

    return {
      totalExecutions: total,
      verifiedExecutions: verified,
      failedVerifications: failed,
      verificationRate: total > 0 ? verified / total : 0,
      averageVerificationTime: 0, // Would need to track timing separately
      verifiersBreakdown
    };
  }

  /**
   * Find inconsistent states
   */
  async findInconsistencies(): Promise<Array<{
    executionId: string;
    expected: any;
    observed: any;
    verifier: string;
  }>> {
    const inconsistencies = [];

    for (const [executionId, state] of this.store.entries()) {
      if (!state.verified) {
        try {
          inconsistencies.push({
            executionId,
            expected: JSON.parse(state.expected),
            observed: JSON.parse(state.observed),
            verifier: state.verifier
          });
        } catch {
          // Skip malformed entries
        }
      }
    }

    return inconsistencies;
  }

  /**
   * Reconcile state differences
   */
  async reconcile(executionId: string, correctiveAction: any): Promise<void> {
    const state = this.store.get(executionId);
    if (!state) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Store reconciliation record
    const reconciliation: RealityState = {
      execution_id: `${executionId}_reconciled`,
      expected: JSON.stringify(correctiveAction.expected),
      observed: JSON.stringify(correctiveAction.observed),
      verified: true,
      verifier: 'reconciliation_engine',
      timestamp: Date.now(),
      proof_hash: createHash('sha256').update(JSON.stringify(correctiveAction)).digest('hex')
    };

    await this.appendToFile(reconciliation);
    console.log(`   [RealityStore] 🔄 Reconciled execution ${executionId}`);
  }

  /**
   * Load persisted state from disk
   */
  async load(): Promise<void> {
    const fs = await import('fs/promises');
    
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const lines = data.trim().split('\n').filter(line => line.length > 0);
      
      for (const line of lines) {
        try {
          const state = JSON.parse(line) as RealityState;
          this.store.set(state.execution_id, state);
        } catch {
          // Skip malformed lines
        }
      }
      
      console.log(`   [RealityStore] 📂 Loaded ${this.store.size} reality states`);
    } catch {
      // File doesn't exist yet
      console.log(`   [RealityStore] 📂 Starting with empty state store`);
    }
  }

  /**
   * Get recent verification failures
   */
  async getRecentFailures(count: number = 10): Promise<RealityState[]> {
    const failures = Array.from(this.store.values())
      .filter(s => !s.verified)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count);

    return failures;
  }

  /**
   * Export state for analysis
   */
  async export(format: 'json' | 'csv' = 'json'): Promise<string> {
    const states = Array.from(this.store.values())
      .sort((a, b) => b.timestamp - a.timestamp);

    if (format === 'json') {
      return JSON.stringify(states, null, 2);
    }

    // CSV format
    const headers = ['execution_id', 'verified', 'verifier', 'timestamp', 'expected', 'observed'];
    const rows = states.map(s => [
      s.execution_id,
      s.verified.toString(),
      s.verifier,
      s.timestamp.toString(),
      `"${s.expected.replace(/"/g, '""')}"`,
      `"${s.observed.replace(/"/g, '""')}"`
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  /**
   * Append state to file
   */
  private async appendToFile(state: RealityState): Promise<void> {
    const fs = await import('fs/promises');
    const line = JSON.stringify(state) + '\n';
    await fs.appendFile(this.filePath, line);
  }

  /**
   * Clear old states (cleanup)
   */
  async cleanup(olderThanDays: number = 30): Promise<number> {
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    let removed = 0;

    for (const [executionId, state] of this.store.entries()) {
      if (state.timestamp < cutoff) {
        this.store.delete(executionId);
        removed++;
      }
    }

    // Rewrite file with remaining states
    const fs = await import('fs/promises');
    const lines = Array.from(this.store.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(s => JSON.stringify(s))
      .join('\n') + '\n';
    
    await fs.writeFile(this.filePath, lines);

    console.log(`   [RealityStore] 🧹 Cleaned up ${removed} old states`);
    return removed;
  }
}
