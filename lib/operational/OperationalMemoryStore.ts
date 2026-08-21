/**
 * Operational Memory — Durable Capability History Store
 *
 * Records the history of capability failures, recoveries, and state transitions.
 * This is HEIDI's long-term memory of what has happened to each capability.
 *
 * Location: .hydi-operational/capability-history.jsonl
 *
 * This is NOT the same as the acquisition lifecycle store (which tracks
 * in-progress acquisitions). This store records the OUTCOME of every
 * capability interaction — success, failure, recovery, escalation — so
 * HEIDI can learn from history and the owner can see what has happened.
 */

import fs from 'fs';
import path from 'path';

export interface CapabilityHistoryRecord {
  id: string;
  timestamp: string;
  capabilityId: string;
  provider: string;
  eventType: 'OBSERVED' | 'ATTEMPTED' | 'BLOCKED' | 'POLICY_BLOCKED' | 'VERIFIED' | 'FAILED' | 'RECOVERED' | 'ESCALATED' | 'RESTARTED' | 'AUTHORIZATION_GRANTED' | 'AUTHORIZATION_DENIED' | 'AUTHORIZATION_REVOKED' | 'CIRCUIT_BREAKER_TRIPPED' | 'RETRY_SCHEDULED';
  state: string;
  reason: string;
  evidence: string;
  retryCount?: number;
  durationMs?: number;
  blocker?: string;
  governanceLevel?: string;
}

export class OperationalMemoryStore {
  private filePath: string;
  private records: CapabilityHistoryRecord[] = [];
  private maxRecords = 10000;

  constructor(root: string) {
    const dir = path.resolve(root, '.hydi-operational');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.resolve(dir, 'capability-history.jsonl');
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const content = fs.readFileSync(this.filePath, 'utf8').trim();
      if (!content) return;
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as CapabilityHistoryRecord;
          this.records.push(record);
        } catch {
          // Skip corrupt lines
        }
      }
      // Trim if too large
      if (this.records.length > this.maxRecords) {
        this.records = this.records.slice(-this.maxRecords);
      }
    } catch {
      // Best effort
    }
  }

  private append(record: CapabilityHistoryRecord): void {
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n');
      this.records.push(record);
      // Rotate if file is too large (> 5MB)
      const stats = fs.statSync(this.filePath);
      if (stats.size > 5 * 1024 * 1024) {
        const backupPath = this.filePath.replace('.jsonl', `.${Date.now()}.jsonl`);
        fs.renameSync(this.filePath, backupPath);
      }
    } catch {
      // Best effort — never crash the daemon
    }
  }

  /**
   * Record a capability event.
   */
  record(event: Omit<CapabilityHistoryRecord, 'id' | 'timestamp'>): void {
    const record: CapabilityHistoryRecord = {
      ...event,
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    this.append(record);
  }

  /**
   * Get the history for a specific capability.
   */
  getHistory(capabilityId: string, limit = 50): CapabilityHistoryRecord[] {
    return this.records
      .filter((r) => r.capabilityId === capabilityId)
      .slice(-limit);
  }

  /**
   * Get recent history for all capabilities.
   */
  getRecentHistory(limit = 100): CapabilityHistoryRecord[] {
    return this.records.slice(-limit);
  }

  /**
   * Get a summary of capability history — counts by event type.
   */
  getSummary(): Record<string, { total: number; byEventType: Record<string, number> }> {
    const summary: Record<string, { total: number; byEventType: Record<string, number> }> = {};
    for (const record of this.records) {
      if (!summary[record.capabilityId]) {
        summary[record.capabilityId] = { total: 0, byEventType: {} };
      }
      summary[record.capabilityId].total++;
      const et = record.eventType;
      summary[record.capabilityId].byEventType[et] = (summary[record.capabilityId].byEventType[et] || 0) + 1;
    }
    return summary;
  }

  /**
   * Get the last N events for a capability.
   */
  getLastEvents(capabilityId: string, count = 5): CapabilityHistoryRecord[] {
    return this.records
      .filter((r) => r.capabilityId === capabilityId)
      .slice(-count);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let memoryInstance: OperationalMemoryStore | null = null;

export function getOperationalMemoryStore(root?: string): OperationalMemoryStore {
  if (!memoryInstance) {
    memoryInstance = new OperationalMemoryStore(root || process.cwd());
  }
  return memoryInstance;
}

export function resetOperationalMemoryStore(): void {
  memoryInstance = null;
}
