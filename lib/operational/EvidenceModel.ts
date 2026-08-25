/**
 * HYDI Evidence Model
 *
 * The core type system that prevents false greens. Every operational
 * result must carry a verification level that distinguishes:
 *
 *   VERIFIED_EXTERNAL — proven against a real external provider API
 *   VERIFIED_INTERNAL — proven against internal state (database, files, logs)
 *   SIMULATED         — produced by a test fixture, mock, or simulation
 *   BLOCKED           — could not be performed; blocker recorded
 *   UNAVAILABLE       — external dependency unavailable
 *   UNKNOWN           — verification not yet performed
 *
 * A SIMULATED result must NEVER satisfy a release gate that requires
 * EXTERNAL_VERIFIED. This is enforced at the type level — the release
 * gate checks the verification level, not just the pass/fail boolean.
 *
 * This extends the existing PolicyDecisionRecord (which records
 * 'success' | 'failure' | 'denied' | 'escalated' | 'no_action' | 'pending')
 * with finer-grained evidence classification for external integrations.
 */

import { randomUUID } from 'crypto';

// ─── Verification Levels ─────────────────────────────────────────────────

/**
 * The verification level of an operational result.
 *
 * CRITICAL: This enum is the backbone of no-false-green enforcement.
 * A release gate requiring EXTERNAL_VERIFIED will reject SIMULATED
 * or VERIFIED_INTERNAL results.
 */
export type VerificationLevel =
  | 'VERIFIED_EXTERNAL'   // proven against real external provider API
  | 'VERIFIED_INTERNAL'   // proven against internal state (DB, files, logs)
  | 'SIMULATED'           // produced by test fixture, mock, or simulation
  | 'BLOCKED'             // could not be performed; blocker recorded
  | 'UNAVAILABLE'         // external dependency unavailable
  | 'UNKNOWN';            // verification not yet performed

/**
 * The result of an evidence-gathering operation.
 */
export type EvidenceResult = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'SIMULATED' | 'UNKNOWN';

// ─── Evidence Record ─────────────────────────────────────────────────────

/**
 * Every autonomous operation produces an evidence record.
 *
 * SECURITY: This record NEVER contains credential values, API keys,
 * webhook secrets, or other secret material. Only metadata, fingerprints,
 * and verification results.
 */
export interface EvidenceRecord {
  /** Unique evidence ID (UUID) */
  id: string;
  /** Links to the operation that produced this evidence */
  operationId: string;
  /** The capability that produced this evidence */
  capability: string;
  /** External provider (e.g., 'stripe', 'supabase') or 'internal' */
  provider: string;
  /** Environment (test, production, development) */
  environment: string;
  /** The action that was performed */
  action: string;
  /** Authorization context (who authorized this) */
  authorization: {
    mode: string;        // 'autonomous' | 'policy_authorized' | 'human_authorized'
    actor: string | null;
    role: string | null;
    permission: string | null;
  };
  /** What was observed */
  observation: string;
  /** How it was verified */
  verification: {
    level: VerificationLevel;
    method: string;       // e.g., 'stripe.api.balance', 'database.query', 'file.hash'
    timestamp: string;
  };
  /** The result */
  result: EvidenceResult;
  /** Confidence in the result (0-1) */
  confidence: number;
  /** Evidence from external sources (API responses, webhook payloads) */
  externalEvidence: string[];
  /** Evidence from internal sources (DB rows, file hashes, log entries) */
  internalEvidence: string[];
  /** Timestamp */
  timestamp: string;
  /** Correlation ID for linking related evidence */
  correlationId: string;
  /** Blocker details if result is BLOCKED */
  blocker: EvidenceBlocker | null;
}

/**
 * Structured blocker information.
 */
export interface EvidenceBlocker {
  type: string;            // e.g., 'EXTERNAL_CREDENTIAL', 'HUMAN_AUTHORIZATION'
  provider: string;        // e.g., 'stripe'
  capability: string;      // e.g., 'stripe-e2e-qualification'
  severity: 'blocking' | 'warning' | 'info';
  repairability: 'auto_repairable' | 'human_required' | 'not_repairable';
  reason: string;
  /** Safe autonomous actions that were attempted before giving up */
  attemptedActions: string[];
  /** What the human needs to do */
  requiredHumanAction: string | null;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// ─── Evidence Store ──────────────────────────────────────────────────────

/**
 * In-memory evidence store with optional durable persistence.
 *
 * This complements the existing PolicyDecisionRecordStore — it does NOT
 * replace it. PolicyDecisionRecord stores the decision audit trail;
 * EvidenceStore stores the verification evidence that backs each decision.
 */
export class EvidenceStore {
  private records: Map<string, EvidenceRecord> = new Map();
  private byOperation: Map<string, string[]> = new Map();
  private byCorrelation: Map<string, string[]> = new Map();
  private byCapability: Map<string, string[]> = new Map();
  private maxRecords: number = 5000;

  /**
   * Record a new evidence entry.
   */
  record(evidence: Omit<EvidenceRecord, 'id' | 'timestamp'>): EvidenceRecord {
    const full: EvidenceRecord = {
      ...evidence,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    this.records.set(full.id, full);

    // Index by operation
    const opRecords = this.byOperation.get(full.operationId) || [];
    opRecords.push(full.id);
    this.byOperation.set(full.operationId, opRecords);

    // Index by correlation
    const corrRecords = this.byCorrelation.get(full.correlationId) || [];
    corrRecords.push(full.id);
    this.byCorrelation.set(full.correlationId, corrRecords);

    // Index by capability
    const capRecords = this.byCapability.get(full.capability) || [];
    capRecords.push(full.id);
    this.byCapability.set(full.capability, capRecords);

    // Trim if over limit
    if (this.records.size > this.maxRecords) {
      const oldest = this.records.keys().next().value;
      if (oldest) {
        this.records.delete(oldest);
      }
    }

    return full;
  }

  /**
   * Get evidence by ID.
   */
  getById(id: string): EvidenceRecord | null {
    return this.records.get(id) || null;
  }

  /**
   * Get all evidence for an operation.
   */
  getByOperation(operationId: string): EvidenceRecord[] {
    const ids = this.byOperation.get(operationId) || [];
    return ids.map(id => this.records.get(id)).filter(Boolean) as EvidenceRecord[];
  }

  /**
   * Get all evidence for a correlation ID.
   */
  getByCorrelation(correlationId: string): EvidenceRecord[] {
    const ids = this.byCorrelation.get(correlationId) || [];
    return ids.map(id => this.records.get(id)).filter(Boolean) as EvidenceRecord[];
  }

  /**
   * Get all evidence for a capability.
   */
  getByCapability(capability: string): EvidenceRecord[] {
    const ids = this.byCapability.get(capability) || [];
    return ids.map(id => this.records.get(id)).filter(Boolean) as EvidenceRecord[];
  }

  /**
   * Get the latest evidence for a capability.
   */
  getLatestForCapability(capability: string): EvidenceRecord | null {
    const records = this.getByCapability(capability);
    if (records.length === 0) return null;
    return records[records.length - 1];
  }

  /**
   * Check if a capability has been externally verified.
   */
  isExternallyVerified(capability: string): boolean {
    const latest = this.getLatestForCapability(capability);
    if (!latest) return false;
    return latest.verification.level === 'VERIFIED_EXTERNAL' && latest.result === 'PASS';
  }

  /**
   * Check if a capability is blocked.
   */
  isBlocked(capability: string): boolean {
    const latest = this.getLatestForCapability(capability);
    if (!latest) return false;
    return latest.result === 'BLOCKED' || latest.verification.level === 'BLOCKED';
  }

  /**
   * Check if a capability's evidence is only simulated.
   * CRITICAL: This is the no-false-green check.
   */
  isSimulated(capability: string): boolean {
    const latest = this.getLatestForCapability(capability);
    if (!latest) return false;
    return latest.verification.level === 'SIMULATED' || latest.result === 'SIMULATED';
  }

  /**
   * Get a summary of all evidence.
   */
  getSummary(): {
    total: number;
    byResult: Record<string, number>;
    byVerificationLevel: Record<string, number>;
    byCapability: Record<string, { latest: EvidenceResult; level: VerificationLevel; timestamp: string }>;
  } {
    const byResult: Record<string, number> = {};
    const byVerificationLevel: Record<string, number> = {};
    const byCapability: Record<string, { latest: EvidenceResult; level: VerificationLevel; timestamp: string }> = {};

    for (const record of this.records.values()) {
      byResult[record.result] = (byResult[record.result] || 0) + 1;
      byVerificationLevel[record.verification.level] = (byVerificationLevel[record.verification.level] || 0) + 1;
      byCapability[record.capability] = {
        latest: record.result,
        level: record.verification.level,
        timestamp: record.timestamp,
      };
    }

    return { total: this.records.size, byResult, byVerificationLevel, byCapability };
  }

  /**
   * Clear all evidence (for testing).
   */
  clear(): void {
    this.records.clear();
    this.byOperation.clear();
    this.byCorrelation.clear();
    this.byCapability.clear();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let evidenceStoreInstance: EvidenceStore | null = null;

export function getEvidenceStore(): EvidenceStore {
  if (!evidenceStoreInstance) {
    evidenceStoreInstance = new EvidenceStore();
  }
  return evidenceStoreInstance;
}

// ─── Helper: Create evidence record ──────────────────────────────────────

export function createEvidence(params: {
  operationId: string;
  capability: string;
  provider: string;
  environment: string;
  action: string;
  authorization: EvidenceRecord['authorization'];
  observation: string;
  verificationLevel: VerificationLevel;
  verificationMethod: string;
  result: EvidenceResult;
  confidence: number;
  externalEvidence?: string[];
  internalEvidence?: string[];
  correlationId: string;
  blocker?: EvidenceBlocker | null;
}): EvidenceRecord {
  return getEvidenceStore().record({
    operationId: params.operationId,
    capability: params.capability,
    provider: params.provider,
    environment: params.environment,
    action: params.action,
    authorization: params.authorization,
    observation: params.observation,
    verification: {
      level: params.verificationLevel,
      method: params.verificationMethod,
      timestamp: new Date().toISOString(),
    },
    result: params.result,
    confidence: params.confidence,
    externalEvidence: params.externalEvidence || [],
    internalEvidence: params.internalEvidence || [],
    correlationId: params.correlationId,
    blocker: params.blocker || null,
  });
}
