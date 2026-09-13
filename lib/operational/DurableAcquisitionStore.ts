/**
 * Durable Acquisition Lifecycle Store
 *
 * Persists acquisition lifecycle state to a local JSONL file so that
 * HEIDI does not forget what it was doing when the daemon restarts.
 *
 * Without this, a Windows restart or Node crash would cause HEIDI to
 * lose all acquisition state — re-starting acquisitions from scratch,
 * potentially creating duplicate provider actions, and losing the audit
 * trail of what was already attempted.
 *
 * Storage format: JSONL file at .hydi-operational/acquisition-lifecycles.jsonl
 * Each line is a lifecycle state record keyed by capabilityId.
 * The store is loaded on construction and saved on every state change.
 *
 * IMPORTANT: This store NEVER persists secret values. Only fingerprints
 * (SHA-256 hashes) are stored. See SecretManager for the redaction layer.
 */

import fs from 'fs';
import path from 'path';
import type { AcquisitionLifecycle, CapabilityAcquisitionState, CapabilityBlocker, PolicyDecision, StateTransition, AcquisitionAuditRecord } from './CapabilityAcquisitionTypes';

/**
 * The durable record — a subset of AcquisitionLifecycle that gets persisted.
 * Audit records and transitions are kept (they're the operational history),
 * but we store only the latest state per capability to avoid unbounded growth.
 */
export interface DurableAcquisitionRecord {
  capabilityId: string;
  provider: string;
  lifecycleId: string;
  currentState: CapabilityAcquisitionState;
  blocker: CapabilityBlocker | null;
  policyDecision: PolicyDecision | null;
  startedAt: string;
  completedAt: string | null;
  lastUpdatedAt: string;
  retryCount: number;
  lastError: string | null;
  credentialFingerprints: Record<string, string>;
  transitions: StateTransition[];
  auditEventCount: number;
  lastAuditEvent?: AcquisitionAuditRecord;
}

const MAX_TRANSITIONS_KEPT = 50;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export class DurableAcquisitionStore {
  private filePath: string;
  private state = new Map<string, DurableAcquisitionRecord>();

  constructor(root: string) {
    const dir = path.resolve(root, '.hydi-operational');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.resolve(dir, 'acquisition-lifecycles.jsonl');
    this.load();
  }

  /**
   * Load durable acquisition state from disk.
   * Last write wins per capabilityId.
   */
  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const content = fs.readFileSync(this.filePath, 'utf8').trim();
      if (!content) return;
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const record: DurableAcquisitionRecord = JSON.parse(line);
          this.state.set(record.capabilityId, record);
        } catch { /* skip malformed */ }
      }
    } catch { /* fresh start if file is corrupt */ }
  }

  /**
   * Save a single capability's acquisition state to disk (append-only JSONL).
   */
  private saveCapability(capabilityId: string): void {
    const record = this.state.get(capabilityId);
    if (!record) return;
    try {
      // Rotate if file is too large
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        if (stats.size > MAX_FILE_SIZE_BYTES) {
          this.rotate();
        }
      }
      fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf8');
    } catch (e) {
      // Best effort — don't kill the daemon if disk write fails, but log it
      console.error(`[DurableAcquisitionStore] Write failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  private rotate(): void {
    try {
      const backupPath = this.filePath.replace('.jsonl', `.${Date.now()}.jsonl`);
      fs.renameSync(this.filePath, backupPath);
    } catch (e) {
      console.error(`[DurableAcquisitionStore] Rotation failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  /**
   * Get the durable state for a capability (or null if not tracked).
   */
  getState(capabilityId: string): DurableAcquisitionRecord | null {
    const state = this.state.get(capabilityId);
    return state ? { ...state } : null;
  }

  /**
   * Get all tracked capabilities' states.
   */
  getAllStates(): DurableAcquisitionRecord[] {
    return Array.from(this.state.values()).map((s) => ({ ...s }));
  }

  /**
   * Update the acquisition state for a capability and persist to disk.
   * Called after every state transition.
   *
   * IMPORTANT: Only appends to disk if the record actually changed.
   * This prevents unbounded JSONL growth from repeated identical state
   * snapshots every daemon cycle.
   */
  updateFromLifecycle(lifecycle: AcquisitionLifecycle): void {
    const existing = this.state.get(lifecycle.capabilityId);
    const transitions = [...(existing?.transitions || []), ...lifecycle.transitions]
      .slice(-MAX_TRANSITIONS_KEPT);

    const record: DurableAcquisitionRecord = {
      capabilityId: lifecycle.capabilityId,
      provider: lifecycle.provider,
      lifecycleId: lifecycle.id,
      currentState: lifecycle.currentState,
      blocker: lifecycle.blocker,
      policyDecision: lifecycle.policyDecision,
      startedAt: lifecycle.startedAt,
      completedAt: lifecycle.completedAt,
      lastUpdatedAt: new Date().toISOString(),
      retryCount: lifecycle.retryCount,
      lastError: lifecycle.lastError,
      credentialFingerprints: lifecycle.credentialFingerprints,
      transitions,
      auditEventCount: lifecycle.auditRecords.length,
      lastAuditEvent: lifecycle.auditRecords[lifecycle.auditRecords.length - 1],
    };

    // Only persist if something actually changed.
    // Compare key fields that matter for operational state.
    if (existing) {
      const unchanged =
        existing.lifecycleId === record.lifecycleId &&
        existing.currentState === record.currentState &&
        existing.blocker === record.blocker &&
        existing.policyDecision === record.policyDecision &&
        existing.retryCount === record.retryCount &&
        existing.lastError === record.lastError &&
        existing.transitions.length === record.transitions.length;
      if (unchanged) {
        // Nothing changed — don't append to disk
        return;
      }
    }

    this.state.set(lifecycle.capabilityId, record);
    this.saveCapability(lifecycle.capabilityId);
  }

  /**
   * Check if a capability has an in-progress acquisition (not completed).
   * Used on daemon restart to resume interrupted acquisitions.
   */
  hasInProgressAcquisition(capabilityId: string): boolean {
    const state = this.state.get(capabilityId);
    if (!state) return false;
    const inProgressStates: CapabilityAcquisitionState[] = [
      'DISCOVERING', 'PLANNED', 'AUTHORIZING', 'ACQUIRING',
      'PROVISIONING', 'CONFIGURING', 'VERIFYING', 'QUALIFYING',
    ];
    return inProgressStates.includes(state.currentState);
  }

  /**
   * Get all capabilities with in-progress acquisitions (for restart recovery).
   */
  getInProgressAcquisitions(): DurableAcquisitionRecord[] {
    return this.getAllStates().filter((s) => this.hasInProgressAcquisition(s.capabilityId));
  }

  /**
   * Clear the state for a capability (e.g., after successful completion).
   * Does NOT delete the audit trail — just clears the "in progress" flag.
   */
  clearInProgress(capabilityId: string): void {
    const state = this.state.get(capabilityId);
    if (state && this.hasInProgressAcquisition(capabilityId)) {
      // Mark as completed but keep the record
      state.currentState = state.currentState === 'READY' ? 'READY' : 'ACQUISITION_FAILED';
      state.completedAt = new Date().toISOString();
      this.saveCapability(capabilityId);
    }
  }

  /**
   * Get the count of tracked capabilities by state.
   */
  getStateCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of this.state.values()) {
      counts[record.currentState] = (counts[record.currentState] || 0) + 1;
    }
    return counts;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let storeInstance: DurableAcquisitionStore | null = null;

export function getDurableAcquisitionStore(root?: string): DurableAcquisitionStore {
  if (!storeInstance) {
    storeInstance = new DurableAcquisitionStore(root || process.cwd());
  }
  return storeInstance;
}

export function resetDurableAcquisitionStore(): void {
  storeInstance = null;
}
