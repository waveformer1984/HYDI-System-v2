/**
 * Live Transaction Authorization
 *
 * An explicit, scoped, single-use, time-bounded authorization object
 * for a controlled live Stripe qualification transaction.
 *
 * This is SEPARATE from ALLOW_LIVE_STRIPE:
 *   ALLOW_LIVE_STRIPE=true  → system may report READY during preflight
 *   LiveTransactionAuthorization → system may create ONE transaction
 *
 * Neither alone is sufficient. Both are required, and the authorization
 * must be freshly issued by an explicit human instruction.
 *
 * Properties:
 *   - explicit: must be created by a fresh human instruction
 *   - scoped: applies to one specific qualification run
 *   - single-use: consumed after one transaction
 *   - time-bounded: expires after a configured window
 *   - amount-bounded: may not exceed the authorized amount
 *   - auditable: every issuance and consumption is recorded
 */

import { randomUUID, createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ─── Types ───────────────────────────────────────────────────────────────

export type AuthorizationState =
  | 'PENDING'      // issued but not yet used
  | 'CONSUMED'     // used for a transaction
  | 'EXPIRED'      // time window elapsed
  | 'REVOKED'      // manually revoked
  | 'REJECTED';    // validation failed

export interface LiveTransactionAuthorization {
  /** Unique authorization ID */
  authorizationId: string;
  /** Scope — always "stripe-production-qualification" */
  scope: string;
  /** Maximum amount in cents */
  amountCents: number;
  /** Currency */
  currency: string;
  /** Maximum number of transactions (always 1) */
  maxTransactions: number;
  /** The controlled customer email */
  customer: string;
  /** When the authorization was issued */
  issuedAt: string;
  /** When the authorization expires */
  expiresAt: string;
  /** Who issued the authorization */
  authorizedBy: string;
  /** Current state */
  state: AuthorizationState;
  /** When the authorization was consumed (if applicable) */
  consumedAt: string | null;
  /** The job ID this authorization was used for */
  consumedByJobId: string | null;
  /** Hash of the authorization for integrity verification */
  integrityHash: string;
}

export interface AuthorizationResult {
  success: boolean;
  authorization: LiveTransactionAuthorization | null;
  error?: string;
}

// ─── Authorization Store ─────────────────────────────────────────────────

const DEFAULT_EXPIRY_MINUTES = 30;
const MAX_AMOUNT_CENTS = 2900; // $29.00 — hard limit
const AUTH_STORE_PATH = join(process.cwd(), '.hydi-operational', 'live-transaction-authorization.json');

// ─── Live Transaction Authorization Manager ──────────────────────────────

export class LiveTransactionAuthorizationManager {
  private authorizations: Map<string, LiveTransactionAuthorization> = new Map();
  private storePath: string;

  constructor(storePath?: string) {
    this.storePath = storePath || AUTH_STORE_PATH;
    this.loadStore();
  }

  /**
   * Issue a new authorization.
   *
   * This must be called ONLY after an explicit human instruction
   * equivalent to "proceed with Stage 1".
   *
   * ALLOW_LIVE_STRIPE=true is NOT sufficient to call this method.
   */
  issue(params: {
    authorizedBy: string;
    customer: string;
    amountCents?: number;
    currency?: string;
    expiryMinutes?: number;
  }): AuthorizationResult {
    const amountCents = params.amountCents ?? MAX_AMOUNT_CENTS;
    const currency = params.currency ?? 'usd';
    const expiryMinutes = params.expiryMinutes ?? DEFAULT_EXPIRY_MINUTES;

    // Hard limits
    if (amountCents > MAX_AMOUNT_CENTS) {
      return {
        success: false,
        authorization: null,
        error: `Amount ${amountCents} cents exceeds maximum allowed ${MAX_AMOUNT_CENTS} cents ($${MAX_AMOUNT_CENTS / 100})`,
      };
    }

    if (amountCents <= 0) {
      return {
        success: false,
        authorization: null,
        error: 'Amount must be positive',
      };
    }

    if (!params.customer || !params.customer.includes('@')) {
      return {
        success: false,
        authorization: null,
        error: 'A valid customer email is required',
      };
    }

    // Check for existing PENDING authorization
    for (const auth of this.authorizations.values()) {
      if (auth.state === 'PENDING') {
        return {
          success: false,
          authorization: null,
          error: `A pending authorization already exists: ${auth.authorizationId}. Revoke it first.`,
        };
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

    const authorizationId = randomUUID();
    const integrityData = `${authorizationId}:${params.authorizedBy}:${params.customer}:${amountCents}:${currency}:${now.toISOString()}`;
    const integrityHash = createHash('sha256').update(integrityData).digest('hex');

    const auth: LiveTransactionAuthorization = {
      authorizationId,
      scope: 'stripe-production-qualification',
      amountCents,
      currency,
      maxTransactions: 1,
      customer: params.customer,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      authorizedBy: params.authorizedBy,
      state: 'PENDING',
      consumedAt: null,
      consumedByJobId: null,
      integrityHash,
    };

    this.authorizations.set(authorizationId, auth);
    this.saveStore();

    return { success: true, authorization: auth };
  }

  /**
   * Validate and consume an authorization for a specific transaction.
   * This is single-use — once consumed, the authorization cannot be reused.
   * @param currency Optional currency check — if provided, must match the authorized currency.
   */
  consume(
    authorizationId: string,
    jobId: string,
    amountCents: number,
    customer: string,
    currency?: string
  ): AuthorizationResult {
    const auth = this.authorizations.get(authorizationId);
    if (!auth) {
      return { success: false, authorization: null, error: 'Authorization not found' };
    }

    if (auth.state !== 'PENDING') {
      return {
        success: false,
        authorization: auth,
        error: `Authorization is ${auth.state}, not PENDING. Cannot be consumed.`,
      };
    }

    // Check expiry
    if (new Date() > new Date(auth.expiresAt)) {
      auth.state = 'EXPIRED';
      this.saveStore();
      return {
        success: false,
        authorization: auth,
        error: 'Authorization has expired',
      };
    }

    // Check amount
    if (amountCents > auth.amountCents) {
      auth.state = 'REJECTED';
      this.saveStore();
      return {
        success: false,
        authorization: auth,
        error: `Amount ${amountCents} cents exceeds authorized ${auth.amountCents} cents`,
      };
    }

    // Check customer
    if (customer !== auth.customer) {
      auth.state = 'REJECTED';
      this.saveStore();
      return {
        success: false,
        authorization: auth,
        error: `Customer "${customer}" does not match authorized customer`,
      };
    }

    // Check currency (if provided and authorization has a currency set)
    if (currency && auth.currency && currency !== auth.currency) {
      auth.state = 'REJECTED';
      this.saveStore();
      return {
        success: false,
        authorization: auth,
        error: `Currency "${currency}" does not match authorized currency "${auth.currency}"`,
      };
    }

    // Consume
    auth.state = 'CONSUMED';
    auth.consumedAt = new Date().toISOString();
    auth.consumedByJobId = jobId;
    this.saveStore();

    return { success: true, authorization: auth };
  }

  /**
   * Revoke a pending authorization.
   */
  revoke(authorizationId: string, revokedBy: string): AuthorizationResult {
    const auth = this.authorizations.get(authorizationId);
    if (!auth) {
      return { success: false, authorization: null, error: 'Authorization not found' };
    }

    if (auth.state === 'CONSUMED') {
      return {
        success: false,
        authorization: auth,
        error: 'Cannot revoke a consumed authorization',
      };
    }

    auth.state = 'REVOKED';
    this.saveStore();

    return { success: true, authorization: auth };
  }

  /**
   * Get the current pending authorization, if any.
   */
  getPending(): LiveTransactionAuthorization | null {
    for (const auth of this.authorizations.values()) {
      if (auth.state === 'PENDING') {
        // Check expiry
        if (new Date() > new Date(auth.expiresAt)) {
          auth.state = 'EXPIRED';
          this.saveStore();
          continue;
        }
        return auth;
      }
    }
    return null;
  }

  /**
   * Get an authorization by ID.
   */
  get(authorizationId: string): LiveTransactionAuthorization | null {
    return this.authorizations.get(authorizationId) || null;
  }

  /**
   * Get all authorizations (for audit).
   */
  getAll(): LiveTransactionAuthorization[] {
    return Array.from(this.authorizations.values());
  }

  /**
   * Check if a transaction is authorized without consuming the authorization.
   * @param currency Optional currency check — if provided, must match the authorized currency.
   */
  checkAuthorized(amountCents: number, customer: string, currency?: string): { authorized: boolean; reason: string; authorization?: LiveTransactionAuthorization } {
    const pending = this.getPending();
    if (!pending) {
      return { authorized: false, reason: 'No pending authorization. Explicit human authorization required.' };
    }

    if (amountCents > pending.amountCents) {
      return { authorized: false, reason: `Amount exceeds authorized limit of ${pending.amountCents} cents`, authorization: pending };
    }

    if (customer !== pending.customer) {
      return { authorized: false, reason: `Customer does not match authorized customer`, authorization: pending };
    }

    if (currency && pending.currency && currency !== pending.currency) {
      return { authorized: false, reason: `Currency does not match authorized currency`, authorization: pending };
    }

    return { authorized: true, reason: 'Authorization valid', authorization: pending };
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  private loadStore(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const data = readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(data);
      for (const auth of Object.values(parsed) as LiveTransactionAuthorization[]) {
        this.authorizations.set(auth.authorizationId, auth);
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
    const data: Record<string, LiveTransactionAuthorization> = {};
    for (const [id, auth] of this.authorizations.entries()) {
      data[id] = auth;
    }
    writeFileSync(this.storePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let singleton: LiveTransactionAuthorizationManager | null = null;

export function getLiveTransactionAuthorizationManager(): LiveTransactionAuthorizationManager {
  if (!singleton) {
    singleton = new LiveTransactionAuthorizationManager();
  }
  return singleton;
}
