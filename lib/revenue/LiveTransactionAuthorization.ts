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
  | 'RESERVED'     // checkout session created but payment not yet confirmed
  | 'CONSUMED'     // payment confirmed — used for a transaction
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
  /** The checkout session ID reserved against this authorization (if RESERVED) */
  reservedCheckoutSessionId: string | null;
  /** The job ID this authorization is reserved for (if RESERVED) */
  reservedByJobId: string | null;
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
      reservedCheckoutSessionId: null,
      reservedByJobId: null,
      integrityHash,
    };

    this.authorizations.set(authorizationId, auth);
    this.saveStore();

    return { success: true, authorization: auth };
  }

  /**
   * Reserve an authorization for a checkout session.
   *
   * This transitions PENDING → RESERVED, binding the checkout session ID.
   * The authorization is NOT consumed — consumption happens only when the
   * webhook confirms payment (checkout.session.completed).
   *
   * Concurrency guarantee: This method is synchronous. In a single Node.js
   * process, the event loop cannot interleave two synchronous calls — the
   * first reserve() runs to completion (including writeFileSync) before the
   * second begins. Therefore two concurrent requests (e.g. Promise.all)
   * cannot both pass the PENDING check and both transition to RESERVED.
   * Only the first wins; the second sees RESERVED and fails.
   *
   * Multi-process caveat: If PM2 cluster mode or any multi-process deployment
   * runs this route in more than one process, each process has its own
   * in-memory Map and singleton. Two processes could both read PENDING from
   * disk and both write RESERVED. For multi-process safety, move the store
   * to the database with a conditional UPDATE (WHERE state = 'PENDING') and
   * check the affected row count.
   *
   * If the auth is already RESERVED with the same checkout session ID,
   * this is idempotent (returns success) — this supports retry within
   * the same window where the customer refreshes the page.
   */
  reserve(
    authorizationId: string,
    jobId: string,
    checkoutSessionId: string,
    amountCents: number,
    customer: string,
    currency?: string
  ): AuthorizationResult {
    const auth = this.authorizations.get(authorizationId);
    if (!auth) {
      return { success: false, authorization: null, error: 'Authorization not found' };
    }

    // Idempotent retry: same session already reserved
    if (auth.state === 'RESERVED' && auth.reservedCheckoutSessionId === checkoutSessionId) {
      return { success: true, authorization: auth };
    }

    // Already reserved by a different session
    if (auth.state === 'RESERVED') {
      return {
        success: false,
        authorization: auth,
        error: `Authorization is already reserved for checkout session ${auth.reservedCheckoutSessionId}`,
      };
    }

    if (auth.state !== 'PENDING') {
      return {
        success: false,
        authorization: auth,
        error: `Authorization is ${auth.state}, not PENDING. Cannot be reserved.`,
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

    // Reserve
    auth.state = 'RESERVED';
    auth.reservedCheckoutSessionId = checkoutSessionId;
    auth.reservedByJobId = jobId;
    this.saveStore();

    return { success: true, authorization: auth };
  }

  /**
   * Release a reservation, returning the authorization to PENDING.
   *
   * This is used when a checkout session is abandoned or expires without
   * payment, allowing the same authorization to be used for a new session
   * within the remaining time window.
   */
  release(authorizationId: string): AuthorizationResult {
    const auth = this.authorizations.get(authorizationId);
    if (!auth) {
      return { success: false, authorization: null, error: 'Authorization not found' };
    }

    if (auth.state !== 'RESERVED') {
      return {
        success: false,
        authorization: auth,
        error: `Authorization is ${auth.state}, not RESERVED. Cannot be released.`,
      };
    }

    // Check expiry — if expired, transition to EXPIRED instead of PENDING
    if (new Date() > new Date(auth.expiresAt)) {
      auth.state = 'EXPIRED';
      this.saveStore();
      return {
        success: false,
        authorization: auth,
        error: 'Authorization has expired',
      };
    }

    auth.state = 'PENDING';
    auth.reservedCheckoutSessionId = null;
    auth.reservedByJobId = null;
    this.saveStore();

    return { success: true, authorization: auth };
  }

  /**
   * Get a RESERVED authorization by its checkout session ID.
   *
   * This is used by the webhook handler to find which authorization to
   * consume when a checkout.session.completed event arrives.
   */
  getByCheckoutSessionId(checkoutSessionId: string): LiveTransactionAuthorization | null {
    for (const auth of this.authorizations.values()) {
      if (auth.state === 'RESERVED' && auth.reservedCheckoutSessionId === checkoutSessionId) {
        return auth;
      }
    }
    return null;
  }

  /**
   * Validate and consume an authorization for a specific transaction.
   *
   * This is called by the webhook handler when checkout.session.completed
   * fires. The authorization must be RESERVED (not PENDING) — reservation
   * happens at checkout session creation time.
   *
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

    // Allow consume from RESERVED (normal path) or PENDING (backward compat
    // for callers that haven't been migrated to the reserve/consume split)
    if (auth.state !== 'RESERVED' && auth.state !== 'PENDING') {
      return {
        success: false,
        authorization: auth,
        error: `Authorization is ${auth.state}, not RESERVED or PENDING. Cannot be consumed.`,
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
   * Get the current pending or reserved authorization, if any.
   *
   * Returns PENDING first, then RESERVED. This allows the checkout route
   * to find an existing reservation for retry (returning the same session
   * URL) or a fresh PENDING auth to reserve.
   */
  getPending(): LiveTransactionAuthorization | null {
    let reserved: LiveTransactionAuthorization | null = null;
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
      if (auth.state === 'RESERVED' && !reserved) {
        // Check expiry
        if (new Date() > new Date(auth.expiresAt)) {
          auth.state = 'EXPIRED';
          this.saveStore();
          continue;
        }
        reserved = auth;
      }
    }
    return reserved;
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
      return { authorized: false, reason: 'No pending or reserved authorization. Explicit human authorization required.' };
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
