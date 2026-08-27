/**
 * Live Authorization Request Manager
 *
 * Implements the one-click "Authorize" flow for going live.
 *
 * Flow:
 *   1. HYDI runs all autonomous steps (preflight, typecheck, build, tests)
 *   2. HYDI stages the transaction details (amount, customer, product)
 *   3. HYDI creates a LiveAuthorizationRequest with:
 *      - a human-readable summary of what's about to happen
 *      - the exact amount, customer, what was verified, what wasn't
 *      - an evidence bundle (what the human will see when they click)
 *      - a 15-minute expiry (not "live mode on forever")
 *      - a request ID (AR-xxx format, matching the existing HumanActionRequest pattern)
 *   4. The human sees the summary and clicks "Allow"
 *   5. The click resolves the request, which:
 *      - sets ALLOW_LIVE_STRIPE=true (operatorOverride, scoped to this request)
 *      - issues a LiveTransactionAuthorization (single-use, scoped, time-bounded)
 *      - records an audit trail (who clicked, what was authorized, evidence link)
 *   6. If nothing happens within 15 minutes, the request lapses
 *   7. A stale "yes" from an hour ago cannot authorize a later transaction
 *
 * This is NOT a global switch. Each Authorize click is scoped to one
 * prepared transaction. The live Stripe key stays in the secure secrets
 * store — it is never displayed or re-entered.
 *
 * This uses the existing HumanActionRequest pattern (AR-a0905a55 style)
 * from StripeCliSessionManager, not a new bespoke mechanism.
 */

import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { ConfigurationControlPlane } from './ConfigurationControlPlane';
import { LiveTransactionAuthorizationManager, type LiveTransactionAuthorization } from '../revenue/LiveTransactionAuthorization';

// ─── Types ───────────────────────────────────────────────────────────────

export interface LiveAuthorizationEvidence {
  /** What was verified by HYDI before requesting authorization */
  verified: string[];
  /** What was NOT verified (known gaps) */
  notVerified: string[];
  /** Preflight state at time of request */
  preflightState: string;
  /** Stripe credential mode at time of request */
  stripeMode: string;
  /** Stripe credential health (metadata only — never the value) */
  stripeCredentialHealth: { configured: boolean; mode: string; valid: boolean; prefix: string | null };
  /** Build/test status at time of request */
  buildStatus: { typecheck: boolean; build: boolean; tests: boolean };
  /** Timestamp of evidence collection */
  collectedAt: string;
}

export interface LiveAuthorizationRequest {
  /** Request ID (AR-xxx format, matching existing HumanActionRequest pattern) */
  id: string;
  /** What is being authorized */
  capability: string;
  /** The exact amount in cents */
  amountCents: number;
  /** Currency */
  currency: string;
  /** The exact customer email */
  customer: string;
  /** The product being purchased */
  product: string;
  /** Human-readable summary of what's about to happen */
  summary: string;
  /** What was verified */
  evidence: LiveAuthorizationEvidence;
  /** Reason for the request */
  reason: string;
  /** What the human must do */
  humanActionRequired: string;
  /** What happens after authorization */
  afterCompletion: string;
  /** Security impact statement */
  securityImpact: string;
  /** When the request was created */
  createdAt: string;
  /** When the request expires (15 minutes from creation) */
  expiresAt: string;
  /** Whether the request has been resolved */
  resolved: boolean;
  /** When it was resolved */
  resolvedAt: string | null;
  /** Who resolved it (e.g. "operator", "operator@example.com") */
  resolvedBy: string | null;
  /** How it was resolved ("approved" | "denied" | "expired" | "revoked") */
  resolution: string | null;
  /** The LiveTransactionAuthorization issued on approval (if any) */
  transactionAuthorizationId: string | null;
  /** Audit trail of the resolution */
  auditRecord: LiveAuthorizationAuditRecord | null;
}

export interface LiveAuthorizationAuditRecord {
  /** Request ID that was resolved */
  requestId: string;
  /** Who clicked (e.g. "operator", "operator@example.com") */
  resolvedBy: string;
  /** How it was resolved */
  resolution: string;
  /** When it was resolved */
  resolvedAt: string;
  /** What was authorized (human-readable) */
  whatWasAuthorized: string;
  /** Link to the evidence bundle that was shown at click time */
  evidenceBundleId: string;
  /** The transaction authorization ID issued (if approved) */
  transactionAuthorizationId: string | null;
  /** The endpoint used to resolve */
  resolvedVia: string;
}

export interface LiveAuthorizationResult {
  success: boolean;
  request: LiveAuthorizationRequest | null;
  transactionAuthorization: LiveTransactionAuthorization | null;
  error?: string;
}

// ─── Live Authorization Request Manager ──────────────────────────────────

const DEFAULT_EXPIRY_MINUTES = 15; // 15-minute window, not "live mode on forever"
const DEFAULT_AMOUNT_CENTS = 2900; // $29.00
const DEFAULT_PRODUCT = 'protoforge_model_prep';

export class LiveAuthorizationRequestManager {
  private requests: Map<string, LiveAuthorizationRequest> = new Map();
  private storePath: string;
  private config: ConfigurationControlPlane;
  private authManager: LiveTransactionAuthorizationManager;

  constructor(
    config: ConfigurationControlPlane,
    authManager: LiveTransactionAuthorizationManager,
    storePath?: string,
  ) {
    this.config = config;
    this.authManager = authManager;
    this.storePath = storePath || join(process.cwd(), '.hydi-operational', 'live-authorization-requests.json');
    this.loadStore();
  }

  /**
   * Stage a transaction and create a LiveAuthorizationRequest.
   *
   * This is called by HYDI after all autonomous steps are complete.
   * It produces a human-readable summary and a pending request that
   * the human can resolve with a single click.
   *
   * This does NOT:
   *   - set ALLOW_LIVE_STRIPE
   *   - issue a LiveTransactionAuthorization
   *   - execute a transaction
   *   - display or require the Stripe key
   */
  stageAuthorization(params: {
    customer: string;
    amountCents?: number;
    currency?: string;
    product?: string;
    evidence: LiveAuthorizationEvidence;
    summary?: string;
  }): LiveAuthorizationResult {
    const amountCents = params.amountCents ?? DEFAULT_AMOUNT_CENTS;
    const currency = params.currency ?? 'usd';
    const product = params.product ?? DEFAULT_PRODUCT;

    // Validate
    if (!params.customer || !params.customer.includes('@')) {
      return { success: false, request: null, transactionAuthorization: null, error: 'A valid customer email is required' };
    }

    if (amountCents <= 0 || amountCents > 2900) {
      return { success: false, request: null, transactionAuthorization: null, error: `Amount must be between 1 and 2900 cents ($29.00 max)` };
    }

    // Check for existing pending request
    const existing = this.getPending();
    if (existing) {
      return {
        success: false,
        request: existing,
        transactionAuthorization: null,
        error: `A pending authorization request already exists: ${existing.id}. Resolve or revoke it first.`,
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_EXPIRY_MINUTES * 60 * 1000);
    const requestId = `AR-${randomUUID().substring(0, 8)}`;

    const summary = params.summary || this.generateSummary(params.customer, amountCents, currency, product, params.evidence);

    const request: LiveAuthorizationRequest = {
      id: requestId,
      capability: 'Live Stripe Qualification Transaction',
      amountCents,
      currency,
      customer: params.customer,
      product,
      summary,
      evidence: params.evidence,
      reason: 'HYDI has completed all autonomous preflight steps and is requesting human authorization to proceed with one controlled live Stripe qualification transaction.',
      humanActionRequired: 'Click "Allow" to authorize this specific transaction. This will enable live mode and issue a single-use, time-bounded transaction authorization. The Stripe key is already stored securely and will not be displayed.',
      afterCompletion: 'HYDI will execute exactly one qualification transaction using the stored live Stripe credential, then automatically disarm live mode and revoke the authorization.',
      securityImpact: 'This authorizes one real financial transaction of $' + (amountCents / 100).toFixed(2) + ' for ' + params.customer + '. The authorization is single-use, scoped to this customer and amount, and expires in ' + DEFAULT_EXPIRY_MINUTES + ' minutes if not used.',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
      transactionAuthorizationId: null,
      auditRecord: null,
    };

    this.requests.set(requestId, request);
    this.saveStore();

    return { success: true, request, transactionAuthorization: null };
  }

  /**
   * Resolve a pending request — the "Allow" click.
   *
   * This:
   *   1. Validates the request exists and is still pending
   *   2. Checks it hasn't expired
   *   3. Sets ALLOW_LIVE_STRIPE=true (operatorOverride — this is the operator action)
   *   4. Issues a LiveTransactionAuthorization (single-use, scoped, time-bounded)
   *   5. Records the audit trail
   *
   * This does NOT:
   *   - execute a transaction (that's a separate step after authorization)
   *   - display or re-enter the Stripe key
   *   - create a global "live mode on forever" switch
   */
  resolveApproval(params: {
    requestId: string;
    resolvedBy: string;
    resolvedVia?: string;
  }): LiveAuthorizationResult {
    const request = this.requests.get(params.requestId);
    if (!request) {
      return { success: false, request: null, transactionAuthorization: null, error: 'Authorization request not found' };
    }

    if (request.resolved) {
      return {
        success: false,
        request,
        transactionAuthorization: null,
        error: `Request already resolved as ${request.resolution} at ${request.resolvedAt}`,
      };
    }

    // Check expiry
    if (new Date() > new Date(request.expiresAt)) {
      request.resolved = true;
      request.resolution = 'expired';
      request.resolvedAt = new Date().toISOString();
      this.saveStore();
      return {
        success: false,
        request,
        transactionAuthorization: null,
        error: 'Authorization request has expired. A fresh request is required.',
      };
    }

    // Step 1: Set ALLOW_LIVE_STRIPE=true with operatorOverride
    // This is the operator action — the click IS the human decision.
    const configResult = this.config.set(
      'ALLOW_LIVE_STRIPE',
      'true',
      params.resolvedBy,
      `One-click authorize: request ${request.id} approved by ${params.resolvedBy}`,
      true, // operatorOverride — this is the operator action
    );

    if (!configResult.success || !configResult.verified) {
      return {
        success: false,
        request,
        transactionAuthorization: null,
        error: `Failed to set ALLOW_LIVE_STRIPE: ${configResult.error}`,
      };
    }

    // Step 2: Issue a LiveTransactionAuthorization (single-use, scoped)
    const authResult = this.authManager.issue({
      authorizedBy: params.resolvedBy,
      customer: request.customer,
      amountCents: request.amountCents,
      currency: request.currency,
      expiryMinutes: DEFAULT_EXPIRY_MINUTES,
    });

    if (!authResult.success || !authResult.authorization) {
      // Rollback the config change
      this.config.set('ALLOW_LIVE_STRIPE', 'false', 'hydi:rollback', 'Rollback: authorization issuance failed', true);
      return {
        success: false,
        request,
        transactionAuthorization: null,
        error: `Failed to issue transaction authorization: ${authResult.error}`,
      };
    }

    // Step 3: Record the audit trail
    const auditRecord: LiveAuthorizationAuditRecord = {
      requestId: request.id,
      resolvedBy: params.resolvedBy,
      resolution: 'approved',
      resolvedAt: new Date().toISOString(),
      whatWasAuthorized: `One live Stripe qualification transaction: $${(request.amountCents / 100).toFixed(2)} ${request.currency} for ${request.customer} (${request.product})`,
      evidenceBundleId: request.id, // The evidence is stored on the request itself
      transactionAuthorizationId: authResult.authorization.authorizationId,
      resolvedVia: params.resolvedVia || 'POST /api/operations/authorize-live',
    };

    request.resolved = true;
    request.resolvedAt = auditRecord.resolvedAt;
    request.resolvedBy = params.resolvedBy;
    request.resolution = 'approved';
    request.transactionAuthorizationId = authResult.authorization.authorizationId;
    request.auditRecord = auditRecord;

    this.saveStore();

    return {
      success: true,
      request,
      transactionAuthorization: authResult.authorization,
    };
  }

  /**
   * Deny a pending request.
   */
  resolveDenial(params: {
    requestId: string;
    resolvedBy: string;
    reason?: string;
  }): LiveAuthorizationResult {
    const request = this.requests.get(params.requestId);
    if (!request) {
      return { success: false, request: null, transactionAuthorization: null, error: 'Authorization request not found' };
    }

    if (request.resolved) {
      return {
        success: false,
        request,
        transactionAuthorization: null,
        error: `Request already resolved as ${request.resolution} at ${request.resolvedAt}`,
      };
    }

    request.resolved = true;
    request.resolution = 'denied';
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = params.resolvedBy;
    request.auditRecord = {
      requestId: request.id,
      resolvedBy: params.resolvedBy,
      resolution: 'denied',
      resolvedAt: request.resolvedAt,
      whatWasAuthorized: 'Nothing — request was denied',
      evidenceBundleId: request.id,
      transactionAuthorizationId: null,
      resolvedVia: 'POST /api/operations/authorize-live',
    };

    this.saveStore();
    return { success: true, request, transactionAuthorization: null };
  }

  /**
   * Revoke a pending request (operator cancels before it's resolved).
   */
  revoke(requestId: string, revokedBy: string): LiveAuthorizationResult {
    const request = this.requests.get(requestId);
    if (!request) {
      return { success: false, request: null, transactionAuthorization: null, error: 'Authorization request not found' };
    }

    if (request.resolved) {
      return {
        success: false,
        request,
        transactionAuthorization: null,
        error: `Request already resolved as ${request.resolution}`,
      };
    }

    request.resolved = true;
    request.resolution = 'revoked';
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = revokedBy;
    request.auditRecord = {
      requestId: request.id,
      resolvedBy: revokedBy,
      resolution: 'revoked',
      resolvedAt: request.resolvedAt,
      whatWasAuthorized: 'Nothing — request was revoked',
      evidenceBundleId: request.id,
      transactionAuthorizationId: null,
      resolvedVia: 'revoke',
    };

    this.saveStore();
    return { success: true, request, transactionAuthorization: null };
  }

  /**
   * AUTO-REVERT: Check whether the authorized window has ended and revert
   * ALLOW_LIVE_STRIPE to false if so.
   *
   * The authorized window ends when EITHER:
   *   1. The LiveTransactionAuthorization is consumed (transaction completed)
   *   2. The LiveTransactionAuthorization expires (15-minute window lapses)
   *   3. The LiveTransactionAuthorization is revoked
   *
   * Whichever comes first. This method is idempotent — calling it when
   * ALLOW_LIVE_STRIPE is already false is a no-op.
   *
   * This should be called:
   *   - After every preflight check
   *   - After every webhook event (in case the transaction completed)
   *   - Periodically (e.g., from a health check or status report)
   *
   * Returns the revert action taken (if any) for audit logging.
   */
  checkAndAutoRevert(): { reverted: boolean; reason: string; authorizationId?: string } {
    // If ALLOW_LIVE_STRIPE is not true, nothing to revert
    const current = this.config.read('ALLOW_LIVE_STRIPE');
    if (current !== 'true') {
      return { reverted: false, reason: 'ALLOW_LIVE_STRIPE is not true — nothing to revert' };
    }

    // Find the approved request that set the flag
    const approvedRequest = Array.from(this.requests.values()).find(
      r => r.resolution === 'approved' && r.transactionAuthorizationId !== null
    );

    if (!approvedRequest || !approvedRequest.transactionAuthorizationId) {
      // No approved request found — the flag was set by some other means.
      // This shouldn't happen in the one-click flow, but if it does, leave
      // the flag alone (don't autonomously revert an operator's manual setting).
      return { reverted: false, reason: 'ALLOW_LIVE_STRIPE is true but no approved one-click request found — leaving flag unchanged' };
    }

    // Check the transaction authorization state
    const auth = this.authManager.get(approvedRequest.transactionAuthorizationId);
    if (!auth) {
      // Authorization was deleted — revert the flag
      this.config.set(
        'ALLOW_LIVE_STRIPE',
        'false',
        'hydi:auto-revert',
        `Auto-revert: transaction authorization ${approvedRequest.transactionAuthorizationId} not found`,
        true, // operatorOverride — safety-reducing, autonomous-safe
      );
      return {
        reverted: true,
        reason: `Transaction authorization ${approvedRequest.transactionAuthorizationId} not found — ALLOW_LIVE_STRIPE reverted to false`,
        authorizationId: approvedRequest.transactionAuthorizationId,
      };
    }

    // If the authorization is consumed, expired, or revoked → revert the flag
    if (auth.state === 'CONSUMED') {
      this.config.set(
        'ALLOW_LIVE_STRIPE',
        'false',
        'hydi:auto-revert',
        `Auto-revert: transaction ${auth.authorizationId} was consumed (transaction completed)`,
        true,
      );
      return {
        reverted: true,
        reason: `Transaction authorization ${auth.authorizationId} consumed — ALLOW_LIVE_STRIPE reverted to false`,
        authorizationId: auth.authorizationId,
      };
    }

    if (auth.state === 'EXPIRED') {
      this.config.set(
        'ALLOW_LIVE_STRIPE',
        'false',
        'hydi:auto-revert',
        `Auto-revert: transaction ${auth.authorizationId} expired (15-minute window lapsed)`,
        true,
      );
      return {
        reverted: true,
        reason: `Transaction authorization ${auth.authorizationId} expired — ALLOW_LIVE_STRIPE reverted to false`,
        authorizationId: auth.authorizationId,
      };
    }

    if (auth.state === 'REVOKED') {
      this.config.set(
        'ALLOW_LIVE_STRIPE',
        'false',
        'hydi:auto-revert',
        `Auto-revert: transaction ${auth.authorizationId} was revoked`,
        true,
      );
      return {
        reverted: true,
        reason: `Transaction authorization ${auth.authorizationId} revoked — ALLOW_LIVE_STRIPE reverted to false`,
        authorizationId: auth.authorizationId,
      };
    }

    if (auth.state === 'REJECTED') {
      this.config.set(
        'ALLOW_LIVE_STRIPE',
        'false',
        'hydi:auto-revert',
        `Auto-revert: transaction ${auth.authorizationId} was rejected`,
        true,
      );
      return {
        reverted: true,
        reason: `Transaction authorization ${auth.authorizationId} rejected — ALLOW_LIVE_STRIPE reverted to false`,
        authorizationId: auth.authorizationId,
      };
    }

    // Authorization is still PENDING — the window is still active
    return {
      reverted: false,
      reason: `Transaction authorization ${auth.authorizationId} is still PENDING — authorized window active`,
      authorizationId: auth.authorizationId,
    };
  }

  /**
   * Get the current pending request, if any.
   * Auto-expires stale requests.
   */
  getPending(): LiveAuthorizationRequest | null {
    const now = new Date();
    for (const request of this.requests.values()) {
      if (!request.resolved) {
        if (now > new Date(request.expiresAt)) {
          request.resolved = true;
          request.resolution = 'expired';
          request.resolvedAt = now.toISOString();
          this.saveStore();
          continue;
        }
        return request;
      }
    }
    return null;
  }

  /**
   * Get a request by ID.
   */
  get(requestId: string): LiveAuthorizationRequest | null {
    return this.requests.get(requestId) || null;
  }

  /**
   * Get all requests (for audit history).
   */
  getAll(): LiveAuthorizationRequest[] {
    return Array.from(this.requests.values()).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Get all resolved requests (audit trail).
   */
  getAuditTrail(): LiveAuthorizationAuditRecord[] {
    return this.getAll()
      .filter(r => r.auditRecord !== null)
      .map(r => r.auditRecord!);
  }

  /**
   * Generate a human-readable summary of what's about to happen.
   */
  private generateSummary(
    customer: string,
    amountCents: number,
    currency: string,
    product: string,
    evidence: LiveAuthorizationEvidence,
  ): string {
    const amount = (amountCents / 100).toFixed(2);
    const lines: string[] = [
      `LIVE STRIPE QUALIFICATION TRANSACTION — AUTHORIZATION REQUEST`,
      ``,
      `What's about to happen:`,
      `  One real Stripe qualification transaction of $${amount} ${currency.toUpperCase()}`,
      `  for customer: ${customer}`,
      `  product: ${product}`,
      ``,
      `What was verified:`,
      ...evidence.verified.map(v => `  ✓ ${v}`),
      ``,
      `What was NOT verified:`,
      ...evidence.notVerified.map(v => `  ✗ ${v}`),
      ``,
      `Preflight state: ${evidence.preflightState}`,
      `Stripe mode: ${evidence.stripeMode}`,
      `Stripe credential: ${evidence.stripeCredentialHealth.configured ? 'configured' : 'NOT configured'}, mode=${evidence.stripeCredentialHealth.mode}, valid=${evidence.stripeCredentialHealth.valid}`,
      `Build status: typecheck=${evidence.buildStatus.typecheck ? 'PASS' : 'FAIL'}, build=${evidence.buildStatus.build ? 'PASS' : 'FAIL'}, tests=${evidence.buildStatus.tests ? 'PASS' : 'FAIL'}`,
      ``,
      `This authorization is:`,
      `  - scoped to this specific transaction (not a global switch)`,
      `  - single-use (cannot be reused for a second transaction)`,
      `  - time-bounded (expires in ${DEFAULT_EXPIRY_MINUTES} minutes if not used)`,
      `  - amount-bounded (max $${amount} ${currency.toUpperCase()})`,
      `  - customer-bounded (only ${customer})`,
      ``,
      `The live Stripe key is already stored securely. It will NOT be displayed.`,
      `Clicking "Allow" authorizes using that stored credential for this one transaction.`,
    ];
    return lines.join('\n');
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  private loadStore(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const data = readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(data);
      for (const req of Object.values(parsed) as LiveAuthorizationRequest[]) {
        this.requests.set(req.id, req);
      }
    } catch {
      // Corrupted store — start fresh
    }
  }

  private saveStore(): void {
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data: Record<string, LiveAuthorizationRequest> = {};
    for (const [id, req] of this.requests.entries()) {
      data[id] = req;
    }
    writeFileSync(this.storePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
  }
}
