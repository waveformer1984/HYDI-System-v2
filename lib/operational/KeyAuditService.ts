/**
 * Key Audit Service
 *
 * Produces immutable audit records for every key lifecycle operation.
 * Records are persisted to JSONL format at .hydi-operational/key-audit.jsonl
 * and survive restarts.
 *
 * SECURITY: Audit records NEVER contain secret material. Only:
 *   - fingerprints (SHA-256 hashes, first 16 hex chars)
 *   - metadata (operation, actor, decision, policy, states)
 *   - timestamps and correlation IDs
 *
 * This builds on the existing PolicyDecisionRecordStore pattern (durable
 * JSONL with rotation) but is specific to key lifecycle operations.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { KeyAuditRecord, KeyAuditOperation, KeyLifecycleState, KeyRiskLevel } from './KeyManagementTypes';
import type { CredentialState } from './CapabilityAcquisitionTypes';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_RECORDS_IN_MEMORY = 2000;

/**
 * Service for recording key lifecycle audit records.
 */
export class KeyAuditService {
  private filePath: string;
  private records: KeyAuditRecord[] = [];
  private writeQueue: KeyAuditRecord[] = [];
  private writeTimer: NodeJS.Timeout | null = null;
  private flushIntervalMs = 5000;
  private destroyed = false;

  constructor(root: string) {
    const dataDir = path.resolve(root, '.hydi-operational');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.resolve(dataDir, 'key-audit.jsonl');
    this.loadExistingRecords();
  }

  /**
   * Record a key lifecycle operation.
   *
   * SECURITY: This method NEVER accepts secret values. Only metadata,
   * fingerprints, and operation results are recorded.
   */
  record(input: {
    operation: KeyAuditOperation;
    actor: string;
    decision: string;
    policy: string | null;
    authorizationResult: string;
    keyId: string;
    provider: string;
    keyIdentifier: string;
    previousState: KeyLifecycleState;
    resultingState: KeyLifecycleState;
    validationResult: CredentialState | null;
    failureReason: string | null;
    riskLevel: KeyRiskLevel;
    durationMs: number;
    fingerprint: string | null;
    correlationId?: string;
    detail?: Record<string, unknown>;
  }): KeyAuditRecord {
    const record: KeyAuditRecord = {
      auditId: randomUUID(),
      correlationId: input.correlationId ?? randomUUID(),
      operation: input.operation,
      actor: input.actor,
      decision: input.decision,
      policy: input.policy,
      authorizationResult: input.authorizationResult,
      keyId: input.keyId,
      provider: input.provider,
      keyIdentifier: input.keyIdentifier,
      previousState: input.previousState,
      resultingState: input.resultingState,
      validationResult: input.validationResult,
      failureReason: input.failureReason,
      riskLevel: input.riskLevel,
      timestamp: new Date().toISOString(),
      durationMs: input.durationMs,
      fingerprint: input.fingerprint,
      detail: input.detail ?? {},
    };

    this.records.push(record);
    if (this.records.length > MAX_RECORDS_IN_MEMORY) {
      this.records.shift();
    }

    this.writeQueue.push(record);
    this.scheduleFlush();

    return record;
  }

  /**
   * Get recent audit records.
   */
  getRecent(limit = 50): KeyAuditRecord[] {
    return this.records.slice(-limit);
  }

  /**
   * Get audit records for a specific key.
   */
  getByKeyId(keyId: string): KeyAuditRecord[] {
    return this.records.filter(r => r.keyId === keyId);
  }

  /**
   * Get audit records for a specific provider.
   */
  getByProvider(provider: string): KeyAuditRecord[] {
    return this.records.filter(r => r.provider === provider);
  }

  /**
   * Get audit records by correlation ID.
   */
  getByCorrelationId(correlationId: string): KeyAuditRecord[] {
    return this.records.filter(r => r.correlationId === correlationId);
  }

  /**
   * Get audit records by operation type.
   */
  getByOperation(operation: KeyAuditOperation): KeyAuditRecord[] {
    return this.records.filter(r => r.operation === operation);
  }

  /**
   * Get all records.
   */
  getAll(): KeyAuditRecord[] {
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
   * Destroy the service, flushing any pending writes.
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
    const lines = toWrite.map(r => JSON.stringify(r)).join('\n') + '\n';

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

// ─── Singleton ───────────────────────────────────────────────────────────

let auditServiceInstance: KeyAuditService | null = null;

export function getKeyAuditService(root?: string): KeyAuditService {
  if (!auditServiceInstance) {
    auditServiceInstance = new KeyAuditService(root ?? process.cwd());
  }
  return auditServiceInstance;
}

export function resetKeyAuditService(): void {
  if (auditServiceInstance) {
    auditServiceInstance.destroy().catch(() => {});
    auditServiceInstance = null;
  }
}
