/**
 * HYDI Policy Decision Record Store
 *
 * Phase 4 — Every autonomous action produces a durable decision record.
 * This is the audit trail for autonomy.
 *
 * Records are stored in JSONL format at .hydi-operational/policy-decisions.jsonl
 * and survive restarts. An operator can reconstruct an incident from the
 * decision log without reading application source code.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { PolicyDecisionRecord } from './types';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_RECORDS_IN_MEMORY = 1000;

export class PolicyDecisionRecordStore {
  private filePath: string;
  private records: PolicyDecisionRecord[] = [];
  private writeQueue: PolicyDecisionRecord[] = [];
  private writeTimer: NodeJS.Timeout | null = null;
  private flushIntervalMs = 5000;
  private destroyed = false;

  constructor(root: string) {
    const dataDir = path.resolve(root, '.hydi-operational');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.resolve(dataDir, 'policy-decisions.jsonl');
    this.loadExistingRecords();
  }

  /**
   * Create and record a new policy decision.
   */
  record(decision: Omit<PolicyDecisionRecord, 'decisionId' | 'timestamp'>): PolicyDecisionRecord {
    const fullRecord: PolicyDecisionRecord = {
      ...decision,
      decisionId: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    this.records.push(fullRecord);
    if (this.records.length > MAX_RECORDS_IN_MEMORY) {
      this.records.shift();
    }

    this.writeQueue.push(fullRecord);
    this.scheduleFlush();

    return fullRecord;
  }

  /**
   * Get recent decisions.
   */
  getRecent(limit = 50): PolicyDecisionRecord[] {
    return this.records.slice(-limit);
  }

  /**
   * Get decisions by incident ID.
   */
  getByIncidentId(incidentId: string): PolicyDecisionRecord[] {
    return this.records.filter((r) => r.incidentId === incidentId);
  }

  /**
   * Get decisions by component.
   */
  getByComponent(component: string): PolicyDecisionRecord[] {
    return this.records.filter((r) => r.component === component);
  }

  /**
   * Get decisions by correlation ID.
   */
  getByCorrelationId(correlationId: string): PolicyDecisionRecord[] {
    return this.records.filter((r) => r.correlationId === correlationId);
  }

  /**
   * Get all records.
   */
  getAll(): PolicyDecisionRecord[] {
    return [...this.records];
  }

  /**
   * Flush pending writes to disk immediately.
   */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.writePending();
  }

  /**
   * Destroy the store, flushing any pending writes.
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.flush();
  }

  private scheduleFlush(): void {
    if (this.writeTimer || this.destroyed) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writePending().catch(() => { /* best effort */ });
    }, this.flushIntervalMs);
  }

  private async writePending(): Promise<void> {
    if (this.writeQueue.length === 0) return;
    const toWrite = this.writeQueue.splice(0);
    const lines = toWrite.map((r) => JSON.stringify(r)).join('\n') + '\n';

    try {
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        if (stats.size > MAX_FILE_SIZE_BYTES) {
          this.rotate();
        }
      }
      fs.appendFileSync(this.filePath, lines);
    } catch {
      this.writeQueue.unshift(...toWrite);
    }
  }

  private rotate(): void {
    try {
      const backupPath = this.filePath.replace('.jsonl', `.${Date.now()}.jsonl`);
      fs.renameSync(this.filePath, backupPath);
    } catch { /* best effort */ }
  }

  private loadExistingRecords(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const content = fs.readFileSync(this.filePath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const start = Math.max(0, lines.length - MAX_RECORDS_IN_MEMORY);
      for (let i = start; i < lines.length; i++) {
        try {
          this.records.push(JSON.parse(lines[i]));
        } catch { /* skip malformed */ }
      }
    } catch { /* file may not exist yet */ }
  }
}
