/**
 * HYDI Durable Owner Authorization Store
 *
 * Phase 14 — Persists owner authorization requests to durable storage so
 * that authorization state survives daemon restarts. An owner authorization
 * is required before HEIDI can execute actions that involve financial, legal,
 * or identity commitments to external providers.
 *
 * The store is:
 *   - Scoped:     each request is tied to a provider + capability + commitment types
 *   - Persistent: JSONL append-only file at .hydi-operational/owner-authorizations.jsonl
 *   - Auditable:  every decision (approve/deny/revoke) records who/when/why
 *   - Revocable:  an active authorization can be revoked at any time
 *   - Time-bounded: authorizations can have an expiry (null = no expiry)
 *
 * IMPORTANT: This store NEVER persists secrets. Authorization requests contain
 * only metadata about WHAT is being authorized — provider, capability, commitment
 * types, constraints — never credentials or API keys.
 *
 * Storage format: JSONL file at .hydi-operational/owner-authorizations.jsonl
 * Each line is an authorization request record keyed by request ID.
 * The store is loaded on construction and saved on every state change.
 * Last write wins per request ID (append-only, replay on load).
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { ExternalCommitmentType, OwnerAuthorization } from './CapabilityAcquisitionTypes';

/**
 * An owner authorization request — the full lifecycle record from
 * PENDING through AUTHORIZED/DENIED/REVOKED/EXPIRED.
 *
 * This extends the OwnerAuthorization concept with a request workflow:
 * the owner is asked, the owner decides, and the decision is recorded
 * with full audit metadata (who, when, why).
 */
export interface AuthorizationRequest {
  id: string;
  provider: string;
  capabilityId: string;
  requestedCommitments: ExternalCommitmentType[];
  estimatedFinancialExposureCents?: number;
  currency?: string;
  requiresLegalAcceptance: boolean;
  requiresIdentityVerification: boolean;
  reason: string;
  status: 'PENDING' | 'AUTHORIZED' | 'DENIED' | 'REVOKED' | 'EXPIRED';
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  denialReason?: string;
  expiresAt: string | null; // null = no expiry
  constraints?: {
    allowedRegions?: string[];
    allowedResources?: string[];
    rateLimitPerHour?: number;
  };
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export class OwnerAuthorizationStore {
  private filePath: string;
  private state = new Map<string, AuthorizationRequest>();

  constructor(root: string) {
    const dir = path.resolve(root, '.hydi-operational');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.resolve(dir, 'owner-authorizations.jsonl');
    this.load();
  }

  /**
   * Load durable authorization state from disk.
   * Last write wins per request ID.
   */
  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const content = fs.readFileSync(this.filePath, 'utf8').trim();
      if (!content) return;
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const record: AuthorizationRequest = JSON.parse(line);
          this.state.set(record.id, record);
        } catch { /* skip malformed */ }
      }
    } catch { /* fresh start if file is corrupt */ }
  }

  /**
   * Save a single authorization request to disk (append-only JSONL).
   * Rotates the file if it grows too large.
   */
  private save(request: AuthorizationRequest): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        if (stats.size > MAX_FILE_SIZE_BYTES) {
          this.rotate();
        }
      }
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.filePath, JSON.stringify(request) + '\n', 'utf8');
    } catch {
      // Best effort — don't kill the daemon if disk write fails
    }
  }

  /**
   * Rotate the JSONL file by renaming it with a timestamp suffix.
   * The in-memory state is preserved; subsequent writes create a fresh file.
   */
  private rotate(): void {
    try {
      const backupPath = this.filePath.replace('.jsonl', `.${Date.now()}.jsonl`);
      fs.renameSync(this.filePath, backupPath);
    } catch { /* best effort */ }
  }

  /**
   * Create a new PENDING authorization request.
   * The caller provides everything except the generated ID, timestamp, and
   * initial status (which are set automatically).
   */
  createRequest(
    request: Omit<AuthorizationRequest, 'id' | 'requestedAt' | 'status' | 'decidedAt' | 'decidedBy'>,
  ): AuthorizationRequest {
    const record: AuthorizationRequest = {
      ...request,
      id: randomUUID(),
      requestedAt: new Date().toISOString(),
      status: 'PENDING',
      decidedAt: null,
      decidedBy: null,
    };
    this.state.set(record.id, record);
    this.save(record);
    return { ...record };
  }

  /**
   * Get all PENDING authorization requests awaiting owner decision.
   */
  getPendingRequests(): AuthorizationRequest[] {
    const pending: AuthorizationRequest[] = [];
    for (const req of this.state.values()) {
      if (req.status === 'PENDING') {
        pending.push({ ...req });
      }
    }
    // Sort by requestedAt ascending (oldest first — most urgent)
    pending.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    return pending;
  }

  /**
   * Get a single authorization request by ID (or null if not found).
   */
  getRequest(id: string): AuthorizationRequest | null {
    const req = this.state.get(id);
    return req ? { ...req } : null;
  }

  /**
   * Approve a PENDING authorization request.
   * Sets status to AUTHORIZED, records who approved and when, and optionally
   * sets an expiry. If no expiry is provided, the request's existing expiresAt
   * (which may be null = no expiry) is preserved.
   */
  approve(id: string, decidedBy: string, expiresAt?: string): AuthorizationRequest | null {
    const req = this.state.get(id);
    if (!req) return null;
    if (req.status !== 'PENDING') return null;

    const updated: AuthorizationRequest = {
      ...req,
      status: 'AUTHORIZED',
      decidedAt: new Date().toISOString(),
      decidedBy,
      expiresAt: expiresAt !== undefined ? expiresAt : req.expiresAt,
    };
    this.state.set(id, updated);
    this.save(updated);
    return { ...updated };
  }

  /**
   * Deny a PENDING authorization request.
   * Sets status to DENIED and records who denied, when, and why.
   */
  deny(id: string, decidedBy: string, reason: string): AuthorizationRequest | null {
    const req = this.state.get(id);
    if (!req) return null;
    if (req.status !== 'PENDING') return null;

    const updated: AuthorizationRequest = {
      ...req,
      status: 'DENIED',
      decidedAt: new Date().toISOString(),
      decidedBy,
      denialReason: reason,
    };
    this.state.set(id, updated);
    this.save(updated);
    return { ...updated };
  }

  /**
   * Revoke an active (AUTHORIZED) authorization.
   * Sets status to REVOKED and records who revoked and when.
   * This is the revocation path — even non-expired authorizations can be
   * pulled back by the owner at any time.
   */
  revoke(id: string, decidedBy: string): AuthorizationRequest | null {
    const req = this.state.get(id);
    if (!req) return null;
    if (req.status !== 'AUTHORIZED') return null;

    const updated: AuthorizationRequest = {
      ...req,
      status: 'REVOKED',
      decidedAt: new Date().toISOString(),
      decidedBy,
    };
    this.state.set(id, updated);
    this.save(updated);
    return { ...updated };
  }

  /**
   * Get all currently active (AUTHORIZED, not expired, not revoked) authorizations.
   */
  getActiveAuthorizations(): AuthorizationRequest[] {
    const now = Date.now();
    const active: AuthorizationRequest[] = [];
    for (const req of this.state.values()) {
      if (req.status !== 'AUTHORIZED') continue;
      if (req.expiresAt && new Date(req.expiresAt).getTime() <= now) continue;
      active.push({ ...req });
    }
    return active;
  }

  /**
   * Check if there is an active authorization for a specific provider +
   * commitment type combination. Returns the matching request or null.
   *
   * This is the gate the acquisition engine calls before executing an
   * external commitment — if this returns null, the engine must create
   * a new authorization request and wait for owner approval.
   */
  getActiveAuthorizationFor(
    provider: string,
    commitmentType: ExternalCommitmentType,
  ): AuthorizationRequest | null {
    const now = Date.now();
    for (const req of this.state.values()) {
      if (req.status !== 'AUTHORIZED') continue;
      if (req.provider !== provider) continue;
      if (!req.requestedCommitments.includes(commitmentType)) continue;
      if (req.expiresAt && new Date(req.expiresAt).getTime() <= now) continue;
      return { ...req };
    }
    return null;
  }

  /**
   * Get all authorization requests, sorted by requestedAt descending (newest first).
   * Optionally limited to the most recent N requests.
   */
  getAllRequests(limit?: number): AuthorizationRequest[] {
    const all = Array.from(this.state.values()).map((r) => ({ ...r }));
    all.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    if (limit !== undefined && limit > 0) {
      return all.slice(0, limit);
    }
    return all;
  }

  /**
   * Mark all AUTHORIZED authorizations whose expiry has passed as EXPIRED.
   * This is a maintenance call — run periodically (e.g. on daemon startup
   * or on a timer) to keep the state model honest.
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [id, req] of this.state) {
      if (req.status !== 'AUTHORIZED') continue;
      if (!req.expiresAt) continue;
      if (new Date(req.expiresAt).getTime() > now) continue;

      const updated: AuthorizationRequest = {
        ...req,
        status: 'EXPIRED',
      };
      this.state.set(id, updated);
      this.save(updated);
    }
  }

  /**
   * Convert an active AuthorizationRequest into an OwnerAuthorization
   * (the governance-layer view of an approved authorization).
   * Returns null if the request is not currently active.
   */
  toOwnerAuthorization(id: string): OwnerAuthorization | null {
    const req = this.state.get(id);
    if (!req || req.status !== 'AUTHORIZED') return null;

    const now = Date.now();
    if (req.expiresAt && new Date(req.expiresAt).getTime() <= now) return null;

    return {
      id: req.id,
      provider: req.provider,
      capabilityId: req.capabilityId,
      authorizedCommitments: req.requestedCommitments,
      maxFinancialCommitmentCents: req.estimatedFinancialExposureCents,
      currency: req.currency,
      grantedAt: req.decidedAt ?? req.requestedAt,
      expiresAt: req.expiresAt,
      revokedAt: null,
      grantedBy: req.decidedBy ?? 'unknown',
      constraints: req.constraints,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let storeInstance: OwnerAuthorizationStore | null = null;

/**
 * Get the singleton OwnerAuthorizationStore instance.
 * The store is created lazily on first access and persists for the
 * lifetime of the process. Pass `root` to set the project root on
 * first initialization (subsequent calls ignore the argument).
 */
export function getOwnerAuthorizationStore(root?: string): OwnerAuthorizationStore {
  if (!storeInstance) {
    storeInstance = new OwnerAuthorizationStore(root || process.cwd());
  }
  return storeInstance;
}

/**
 * Reset the singleton instance. Primarily for testing — production
 * code should not call this.
 */
export function resetOwnerAuthorizationStore(): void {
  storeInstance = null;
}
