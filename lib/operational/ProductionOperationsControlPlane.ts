/**
 * Production Operations Control Plane
 *
 * The central orchestrator that integrates:
 *   - ConfigurationControlPlane (governed .env.local management)
 *   - CredentialManager (unified credential facade)
 *   - LiveTransactionAuthorization (explicit, single-use transaction auth)
 *   - BlockerResolutionEngine (blocker classification and resolution)
 *   - Existing preflight infrastructure (live-transaction-preflight.js)
 *
 * This is NOT a parallel architecture. It wraps existing components
 * into a coherent control plane for production operations.
 *
 * The control plane enables HYDI to:
 *   1. Detect production blockers
 *   2. Classify them (AUTO_RESOLVABLE / OPERATOR_INPUT_REQUIRED / HUMAN_AUTHORIZATION_REQUIRED / PROHIBITED)
 *   3. Resolve everything within its authority
 *   4. Request secure operator input only when a secret is genuinely required
 *   5. Run preflight and report READY
 *   6. STOP and wait for explicit human authorization before any transaction
 *
 * READY must NEVER automatically trigger a transaction.
 */

import { ConfigurationControlPlane, getConfigurationControlPlane } from './ConfigurationControlPlane';
import { CredentialManager, getCredentialManager } from './CredentialManager';
import {
  LiveTransactionAuthorizationManager,
  getLiveTransactionAuthorizationManager,
  type LiveTransactionAuthorization,
} from '../revenue/LiveTransactionAuthorization';
import {
  LiveAuthorizationRequestManager,
  type LiveAuthorizationRequest,
  type LiveAuthorizationEvidence,
  type LiveAuthorizationResult,
  type LiveAuthorizationAuditRecord,
} from './LiveAuthorizationRequestManager';
import { getStripeMode, isLiveModeAuthorized } from '../revenue/stripe-mode';
import { randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────

export type BlockerOwner = 'hydi' | 'operator' | 'human_authorization' | 'prohibited';
export type BlockerResolution =
  | 'AUTO_RESOLVABLE'
  | 'OPERATOR_INPUT_REQUIRED'
  | 'HUMAN_AUTHORIZATION_REQUIRED'
  | 'PROHIBITED';

export interface ProductionBlocker {
  /** Unique blocker code (e.g., STRIPE_CREDENTIAL_TEST_MODE) */
  code: string;
  /** Human-readable description */
  description: string;
  /** Who owns resolving this blocker */
  owner: BlockerOwner;
  /** What type of resolution is required */
  resolution: BlockerResolution;
  /** What action HYDI can take (if any) */
  hydiAction: string | null;
  /** What action the operator must take (if any) */
  operatorAction: string | null;
  /** Whether this blocker prevents READY state */
  blocks: boolean;
}

export interface PreflightResult {
  state: 'READY' | 'BLOCKED' | 'FAILED';
  timestamp: string;
  runId: string;
  blockers: ProductionBlocker[];
  checks: PreflightCheck[];
  stripeMode: string;
  liveAuthorization: boolean;
  customerConfigured: boolean;
  transactionPermission: 'WAITING_FOR_HUMAN_AUTHORIZATION' | 'NOT_APPLICABLE' | 'BLOCKED';
  summary: string;
}

export interface PreflightCheck {
  label: string;
  status: 'PASS' | 'FAIL' | 'INFO';
  detail: string;
}

export interface BlockerResolutionResult {
  blockerCode: string;
  resolved: boolean;
  action: string;
  error?: string;
  requiresOperatorInput: boolean;
  requiresHumanAuthorization: boolean;
}

// ─── Production Operations Control Plane ─────────────────────────────────

export class ProductionOperationsControlPlane {
  private config: ConfigurationControlPlane;
  private credentials: CredentialManager;
  private authManager: LiveTransactionAuthorizationManager;
  private authRequestManager: LiveAuthorizationRequestManager | null;

  constructor(deps?: {
    config?: ConfigurationControlPlane;
    credentials?: CredentialManager;
    authManager?: LiveTransactionAuthorizationManager;
    authRequestManager?: LiveAuthorizationRequestManager;
  }) {
    this.config = deps?.config ?? getConfigurationControlPlane();
    this.credentials = deps?.credentials ?? getCredentialManager();
    this.authManager = deps?.authManager ?? getLiveTransactionAuthorizationManager();
    this.authRequestManager = deps?.authRequestManager ?? null;
  }

  /**
   * Get the LiveAuthorizationRequestManager (lazy-init if not injected).
   */
  getAuthRequestManager(): LiveAuthorizationRequestManager {
    if (!this.authRequestManager) {
      this.authRequestManager = new LiveAuthorizationRequestManager(this.config, this.authManager);
    }
    return this.authRequestManager;
  }

  /**
   * Run a read-only preflight check.
   *
   * This inspects:
   *   - production state
   *   - credential health
   *   - configuration
   *   - Stripe mode
   *   - authorization state
   *   - qualification customer
   *   - safety gates
   *
   * It does NOT create any objects, modify any state, or initiate
   * any transaction. It is strictly report-only.
   */
  async runPreflight(): Promise<PreflightResult> {
    const runId = `preflight-${randomUUID()}`;
    const timestamp = new Date().toISOString();
    const checks: PreflightCheck[] = [];
    const blockers: ProductionBlocker[] = [];

    // AUTO-REVERT: Before reading the flag, check whether the authorized
    // window has ended (transaction consumed, expired, or revoked) and
    // revert ALLOW_LIVE_STRIPE to false if so. This ensures the flag
    // doesn't stay true after the one authorized transaction completes
    // or the 15-minute window lapses.
    try {
      this.getAuthRequestManager().checkAndAutoRevert();
    } catch {
      // Auto-revert failure must not block preflight
    }

    // === Configuration checks ===
    const allowLive = this.config.read('ALLOW_LIVE_STRIPE');
    const customerEmail = this.config.read('LIVE_QUALIFICATION_CUSTOMER_EMAIL');
    const webhookEnabled = this.config.read('WEBHOOK_PROCESSING_ENABLED');

    checks.push({
      label: 'ALLOW_LIVE_STRIPE',
      status: allowLive === 'true' ? 'PASS' : 'INFO',
      detail: `ALLOW_LIVE_STRIPE=${allowLive || 'unset'}`,
    });

    checks.push({
      label: 'LIVE_QUALIFICATION_CUSTOMER_EMAIL',
      status: customerEmail ? 'PASS' : 'FAIL',
      detail: customerEmail ? 'CONFIGURED' : 'UNSET',
    });

    checks.push({
      label: 'WEBHOOK_PROCESSING_ENABLED',
      status: webhookEnabled === 'true' ? 'PASS' : 'FAIL',
      detail: `WEBHOOK_PROCESSING_ENABLED=${webhookEnabled || 'unset'}`,
    });

    // === Credential checks ===
    const stripeHealth = await this.credentials.getStripeCredentialHealth();

    checks.push({
      label: 'Stripe credential configured',
      status: stripeHealth.configured ? 'PASS' : 'FAIL',
      detail: stripeHealth.configured ? `${stripeHealth.prefix}` : 'NOT CONFIGURED',
    });

    checks.push({
      label: 'Stripe mode',
      status: stripeHealth.mode === 'live' ? 'PASS' : stripeHealth.mode === 'test' ? 'INFO' : 'FAIL',
      detail: stripeHealth.mode,
    });

    checks.push({
      label: 'Stripe live authorization',
      status: stripeHealth.authorizationState === 'enabled' ? 'PASS' : 'INFO',
      detail: stripeHealth.authorizationState,
    });

    // === Identify blockers ===

    // Blocker: Stripe credential in test mode
    if (stripeHealth.configured && stripeHealth.mode === 'test') {
      blockers.push({
        code: 'STRIPE_CREDENTIAL_TEST_MODE',
        description: 'Stripe credential is in test mode. A live credential is required for a live transaction.',
        owner: 'operator',
        resolution: 'OPERATOR_INPUT_REQUIRED',
        hydiAction: null,
        operatorAction: 'Provide a live Stripe key through the secure credential input channel.',
        blocks: true,
      });
    }

    // Blocker: Stripe credential not configured
    if (!stripeHealth.configured) {
      blockers.push({
        code: 'STRIPE_CREDENTIAL_MISSING',
        description: 'No Stripe credential found in any source.',
        owner: 'operator',
        resolution: 'OPERATOR_INPUT_REQUIRED',
        hydiAction: null,
        operatorAction: 'Provide a Stripe key through the secure credential input channel.',
        blocks: true,
      });
    }

    // Blocker: ALLOW_LIVE_STRIPE not set
    //
    // This flag represents a deliberate human decision to move from test
    // money to real money. It is operator-owned — HYDI must NEVER set it
    // autonomously. The test for HYDI-owned vs operator-owned is not
    // "can HYDI technically flip this env var" but "does flipping this
    // represent a deliberate human decision with financial consequence."
    // This one does.
    if (allowLive !== 'true') {
      blockers.push({
        code: 'ALLOW_LIVE_STRIPE_UNSET',
        description: 'ALLOW_LIVE_STRIPE is not set to "true". The system cannot enter live mode. This flag represents a deliberate human decision to move from test to live money.',
        owner: 'operator',
        resolution: 'OPERATOR_INPUT_REQUIRED',
        hydiAction: null,
        operatorAction: 'Set ALLOW_LIVE_STRIPE=true in .env.local. This represents your explicit decision to enable live payment mode.',
        blocks: true,
      });
    }

    // Blocker: Qualification customer not configured
    if (!customerEmail) {
      blockers.push({
        code: 'QUALIFICATION_CUSTOMER_UNSET',
        description: 'LIVE_QUALIFICATION_CUSTOMER_EMAIL is not configured.',
        owner: 'hydi',
        resolution: 'AUTO_RESOLVABLE',
        hydiAction: 'Set LIVE_QUALIFICATION_CUSTOMER_EMAIL in .env.local (requires operator-provided email)',
        operatorAction: 'Provide the controlled customer email address.',
        blocks: true,
      });
    }

    // Blocker: Webhook processing disabled
    if (webhookEnabled !== 'true') {
      blockers.push({
        code: 'WEBHOOK_PROCESSING_DISABLED',
        description: 'WEBHOOK_PROCESSING_ENABLED is not "true". Webhook events will not be processed.',
        owner: 'hydi',
        resolution: 'AUTO_RESOLVABLE',
        hydiAction: 'Set WEBHOOK_PROCESSING_ENABLED=true in .env.local',
        operatorAction: null,
        blocks: true,
      });
    }

    // === Determine state ===
    const blockingBlockers = blockers.filter(b => b.blocks);
    const allChecksPass = checks.every(c => c.status !== 'FAIL');

    let state: 'READY' | 'BLOCKED' | 'FAILED';
    let transactionPermission: 'WAITING_FOR_HUMAN_AUTHORIZATION' | 'NOT_APPLICABLE' | 'BLOCKED';

    if (blockingBlockers.length === 0 && allChecksPass) {
      state = 'READY';
      transactionPermission = 'WAITING_FOR_HUMAN_AUTHORIZATION';
    } else {
      state = 'BLOCKED';
      transactionPermission = 'BLOCKED';
    }

    const stripeMode = stripeHealth.mode;
    const liveAuth = stripeHealth.authorizationState === 'enabled';
    const customerConfigured = !!customerEmail;

    const summary = state === 'READY'
      ? 'All production prerequisites satisfied. Transaction not authorized. Explicit Stage 1 authorization required.'
      : `Preflight blocked: ${blockingBlockers.length} blocker(s). ${blockingBlockers.map(b => b.code).join(', ')}`;

    return {
      state,
      timestamp,
      runId,
      blockers,
      checks,
      stripeMode,
      liveAuthorization: liveAuth,
      customerConfigured,
      transactionPermission,
      summary,
    };
  }

  /**
   * Attempt to resolve all blockers within HYDI's authority.
   *
   * AUTO_RESOLVABLE blockers are resolved immediately.
   * OPERATOR_INPUT_REQUIRED blockers are reported but not resolved.
   * HUMAN_AUTHORIZATION_REQUIRED blockers are reported but not resolved.
   * PROHIBITED blockers are refused.
   */
  async resolveBlockers(blockers: ProductionBlocker[]): Promise<BlockerResolutionResult[]> {
    const results: BlockerResolutionResult[] = [];

    for (const blocker of blockers) {
      switch (blocker.resolution) {
        case 'AUTO_RESOLVABLE':
          results.push(await this.resolveAutoResolvable(blocker));
          break;
        case 'OPERATOR_INPUT_REQUIRED':
          results.push({
            blockerCode: blocker.code,
            resolved: false,
            action: 'Requires operator input — cannot resolve autonomously',
            requiresOperatorInput: true,
            requiresHumanAuthorization: false,
          });
          break;
        case 'HUMAN_AUTHORIZATION_REQUIRED':
          results.push({
            blockerCode: blocker.code,
            resolved: false,
            action: 'Requires explicit human authorization — cannot resolve autonomously',
            requiresOperatorInput: false,
            requiresHumanAuthorization: true,
          });
          break;
        case 'PROHIBITED':
          results.push({
            blockerCode: blocker.code,
            resolved: false,
            action: 'PROHIBITED — refused and recorded',
            requiresOperatorInput: false,
            requiresHumanAuthorization: false,
          });
          break;
      }
    }

    return results;
  }

  /**
   * Resolve an auto-resolvable blocker.
   *
   * NOTE: ALLOW_LIVE_STRIPE_UNSET is NOT here. That flag represents a
   * deliberate human decision to move from test to live money and is
   * operator-owned. HYDI must never set it autonomously.
   */
  private async resolveAutoResolvable(blocker: ProductionBlocker): Promise<BlockerResolutionResult> {
    switch (blocker.code) {
      case 'WEBHOOK_PROCESSING_DISABLED': {
        const result = this.config.set(
          'WEBHOOK_PROCESSING_ENABLED',
          'true',
          'hydi:control-plane',
          'Auto-resolving: enabling webhook processing'
        );
        return {
          blockerCode: blocker.code,
          resolved: result.success && result.verified,
          action: `Set WEBHOOK_PROCESSING_ENABLED=true (verified: ${result.verified})`,
          error: result.error,
          requiresOperatorInput: false,
          requiresHumanAuthorization: false,
        };
      }
      case 'QUALIFICATION_CUSTOMER_UNSET': {
        return {
          blockerCode: blocker.code,
          resolved: false,
          action: 'Cannot auto-resolve — requires operator-provided customer email',
          requiresOperatorInput: true,
          requiresHumanAuthorization: false,
        };
      }
      default:
        return {
          blockerCode: blocker.code,
          resolved: false,
          action: `No auto-resolution handler for ${blocker.code}`,
          requiresOperatorInput: false,
          requiresHumanAuthorization: false,
        };
    }
  }

  /**
   * Store a credential received through the secure operator input channel.
   * The value never passes through the LLM.
   */
  async storeCredentialSecurely(
    provider: 'stripe' | 'supabase' | 'vercel' | 'keeper' | 'generic',
    credentialType: string,
    environment: 'test' | 'live' | 'development' | 'unknown',
    value: string,
    authorizedBy: { actor: string; role: string }
  ): Promise<{ success: boolean; error?: string; auditId: string }> {
    const result = await this.credentials.storeCredential(provider, credentialType, environment, value, authorizedBy);
    return {
      success: result.success,
      error: result.error,
      auditId: result.auditId,
    };
  }

  /**
   * Issue a live transaction authorization.
   *
   * This must ONLY be called after an explicit human instruction
   * equivalent to "proceed with Stage 1".
   */
  issueTransactionAuthorization(params: {
    authorizedBy: string;
    customer: string;
    amountCents?: number;
  }): { success: boolean; authorization?: LiveTransactionAuthorization; error?: string } {
    const result = this.authManager.issue(params);
    return {
      success: result.success,
      authorization: result.authorization || undefined,
      error: result.error,
    };
  }

  /**
   * Check whether a transaction is currently authorized.
   * Does NOT consume the authorization.
   */
  checkTransactionAuthorized(amountCents: number, customer: string): {
    authorized: boolean;
    reason: string;
    authorization?: LiveTransactionAuthorization;
  } {
    return this.authManager.checkAuthorized(amountCents, customer);
  }

  /**
   * Consume a transaction authorization (single-use).
   */
  consumeTransactionAuthorization(
    authorizationId: string,
    jobId: string,
    amountCents: number,
    customer: string
  ): { success: boolean; error?: string } {
    const result = this.authManager.consume(authorizationId, jobId, amountCents, customer);
    return { success: result.success, error: result.error };
  }

  /**
   * Revoke a pending transaction authorization.
   */
  revokeTransactionAuthorization(authorizationId: string, revokedBy: string): { success: boolean; error?: string } {
    const result = this.authManager.revoke(authorizationId, revokedBy);
    return { success: result.success, error: result.error };
  }

  /**
   * Disarm live qualification mode.
   *
   * This is a safety-reducing operation that:
   *   1. Disables ALLOW_LIVE_STRIPE (sets to "false")
   *   2. Revokes any pending transaction authorization
   *   3. Verifies the runtime state
   *   4. Verifies no further qualification transaction can execute
   *   5. Writes an audit record
   *
   * This operation is IDEMPOTENT — calling it when already disarmed
   * returns ALREADY_DISARMED without error.
   *
   * This operation does NOT:
   *   - create or authorize a transaction
   *   - alter unrelated production configuration
   *   - expose credentials
   *
   * After a successful qualification lifecycle, disarming is a safe
   * autonomous operation — it reduces risk by ensuring no further
   * live transactions can execute.
   */
  async disarmLiveQualification(reason: string = 'Post-qualification safety disarm'): Promise<{
    state: 'DISARMED' | 'ALREADY_DISARMED';
    actions: string[];
    verified: boolean;
    auditRecord: { timestamp: string; action: string; actor: string; reason: string };
  }> {
    const actions: string[] = [];
    const timestamp = new Date().toISOString();
    const actor = 'hydi:control-plane';

    // 1. Check if already disarmed
    const currentAllowLive = this.config.read('ALLOW_LIVE_STRIPE');
    const pendingAuth = this.authManager.getPending();

    if (currentAllowLive !== 'true' && !pendingAuth) {
      // Already disarmed — idempotent return
      return {
        state: 'ALREADY_DISARMED',
        actions: ['No-op: ALLOW_LIVE_STRIPE already false, no pending authorization'],
        verified: true,
        auditRecord: { timestamp, action: 'disarm_noop', actor, reason: 'Already disarmed' },
      };
    }

    // 2. Disable ALLOW_LIVE_STRIPE
    if (currentAllowLive === 'true') {
      // Disarm is safety-reducing (turning OFF live mode), so HYDI is allowed
      // to do it autonomously. Use operatorOverride to bypass the autoModifiable
      // check, since this is reducing risk, not increasing it.
      const result = this.config.set('ALLOW_LIVE_STRIPE', 'false', actor, reason, true);
      if (result.success && result.verified) {
        actions.push('ALLOW_LIVE_STRIPE set to false (verified)');
      } else {
        actions.push(`ALLOW_LIVE_STRIPE set failed: ${result.error || 'verification failed'}`);
      }
    }

    // 3. Revoke any pending transaction authorization
    if (pendingAuth) {
      const revokeResult = this.authManager.revoke(pendingAuth.authorizationId, actor);
      if (revokeResult.success) {
        actions.push(`Authorization ${pendingAuth.authorizationId} revoked`);
      } else {
        actions.push(`Authorization revoke failed: ${revokeResult.error || 'unknown'}`);
      }
    }

    // 4. Verify the runtime state
    const verifyAllowLive = this.config.read('ALLOW_LIVE_STRIPE');
    const verifyPendingAuth = this.authManager.getPending();
    const verified = verifyAllowLive !== 'true' && !verifyPendingAuth;

    if (verified) {
      actions.push('Verification: ALLOW_LIVE_STRIPE is false, no pending authorization');
    } else {
      actions.push(`Verification FAILED: ALLOW_LIVE_STRIPE=${verifyAllowLive}, pendingAuth=${!!verifyPendingAuth}`);
    }

    // 5. Verify no further qualification transaction can execute
    // A transaction requires both ALLOW_LIVE_STRIPE=true AND a valid authorization.
    // With ALLOW_LIVE_STRIPE=false, no transaction can proceed.
    const transactionBlocked = verifyAllowLive !== 'true';
    if (transactionBlocked) {
      actions.push('Verified: no further qualification transaction can execute');
    } else {
      actions.push('WARNING: transaction may still be possible');
    }

    return {
      state: 'DISARMED',
      actions,
      verified,
      auditRecord: { timestamp, action: 'disarm_live_qualification', actor, reason },
    };
  }

  /**
   * Stage a live authorization request — the one-click "Authorize" flow.
   *
   * This runs all autonomous steps (preflight) and stages a
   * LiveAuthorizationRequest that the human can resolve with a single click.
   *
   * This does NOT:
   *   - set ALLOW_LIVE_STRIPE (that happens on approval click)
   *   - issue a transaction authorization (that happens on approval click)
   *   - execute a transaction
   *   - display or require the Stripe key
   *
   * Returns the pending request with a human-readable summary.
   */
  async stageLiveAuthorization(params: {
    customer?: string;
    amountCents?: number;
    product?: string;
  }): Promise<LiveAuthorizationResult> {
    // Run preflight to collect evidence
    const preflight = await this.runPreflight();
    const credHealth = await this.credentials.getStripeCredentialHealth();

    const customer = params.customer || this.config.read('LIVE_QUALIFICATION_CUSTOMER_EMAIL') || '';
    if (!customer) {
      return {
        success: false,
        request: null,
        transactionAuthorization: null,
        error: 'No customer email configured. Set LIVE_QUALIFICATION_CUSTOMER_EMAIL or provide customer parameter.',
      };
    }

    const evidence: LiveAuthorizationEvidence = {
      verified: preflight.checks.filter(c => c.status === 'PASS').map(c => c.label),
      notVerified: preflight.blockers.map(b => `${b.code}: ${b.description}`),
      preflightState: preflight.state,
      stripeMode: preflight.stripeMode || 'unknown',
      stripeCredentialHealth: {
        configured: credHealth.configured,
        mode: credHealth.mode,
        valid: credHealth.valid,
        prefix: credHealth.prefix,
      },
      buildStatus: {
        // These are not run here — they're filled in by the caller if desired
        typecheck: false,
        build: false,
        tests: false,
      },
      collectedAt: new Date().toISOString(),
    };

    return this.getAuthRequestManager().stageAuthorization({
      customer,
      amountCents: params.amountCents,
      product: params.product,
      evidence,
    });
  }

  /**
   * Resolve a live authorization request — the "Allow" click.
   *
   * This is the operator action. It:
   *   1. Sets ALLOW_LIVE_STRIPE=true (operatorOverride)
   *   2. Issues a LiveTransactionAuthorization (single-use, scoped)
   *   3. Records the audit trail
   *
   * This does NOT execute a transaction.
   */
  resolveLiveAuthorization(params: {
    requestId: string;
    resolvedBy: string;
    resolution: 'approve' | 'deny';
    resolvedVia?: string;
  }): LiveAuthorizationResult {
    const mgr = this.getAuthRequestManager();
    if (params.resolution === 'approve') {
      return mgr.resolveApproval({
        requestId: params.requestId,
        resolvedBy: params.resolvedBy,
        resolvedVia: params.resolvedVia,
      });
    } else {
      return mgr.resolveDenial({
        requestId: params.requestId,
        resolvedBy: params.resolvedBy,
      });
    }
  }

  /**
   * Get the pending live authorization request (if any).
   */
  getPendingLiveAuthorizationRequest(): LiveAuthorizationRequest | null {
    return this.getAuthRequestManager().getPending();
  }

  /**
   * Get a live authorization request by ID.
   */
  getLiveAuthorizationRequest(requestId: string): LiveAuthorizationRequest | null {
    return this.getAuthRequestManager().get(requestId);
  }

  /**
   * Get the audit trail of all resolved authorization requests.
   */
  getLiveAuthorizationAuditTrail(): LiveAuthorizationAuditRecord[] {
    return this.getAuthRequestManager().getAuditTrail();
  }

  /**
   * Revoke a pending live authorization request.
   */
  revokeLiveAuthorizationRequest(requestId: string, revokedBy: string): LiveAuthorizationResult {
    return this.getAuthRequestManager().revoke(requestId, revokedBy);
  }

  /**
   * Get a safe, redacted status report for display.
   * NEVER includes secret values.
   */
  async getStatusReport(): Promise<{
    configuration: Record<string, { value: string | null; description: string; isSecret: boolean }>;
    stripeCredential: import('./CredentialManager').StripeCredentialHealth;
    pendingAuthorization: LiveTransactionAuthorization | null;
    configAuditLog: import('./ConfigurationControlPlane').ConfigChange[];
    credentialAuditLog: any[];
  }> {
    // AUTO-REVERT: Check whether the authorized window has ended
    try {
      this.getAuthRequestManager().checkAndAutoRevert();
    } catch {
      // Auto-revert failure must not block status report
    }

    const stripeHealth = await this.credentials.getStripeCredentialHealth();
    const pendingAuth = this.authManager.getPending();

    return {
      configuration: this.config.getSafeSummary(),
      stripeCredential: stripeHealth,
      pendingAuthorization: pendingAuth,
      configAuditLog: this.config.getAuditLog(),
      credentialAuditLog: this.credentials.getAuditLog(),
    };
  }

  /**
   * Get Stripe credential health metadata only.
   * NEVER includes the raw key value.
   */
  async getCredentialHealthReport(): Promise<import('./CredentialManager').StripeCredentialHealth> {
    return this.credentials.getStripeCredentialHealth();
  }

  /**
   * Get the current transaction authorization state.
   * This reports whether a pending authorization EXISTS.
   * It does NOT create one — authorization creation is human-only.
   */
  getTransactionAuthorizationState(): {
    hasPendingAuthorization: boolean;
    authorization: LiveTransactionAuthorization | null;
  } {
    const pending = this.authManager.getPending();
    return {
      hasPendingAuthorization: pending !== null,
      authorization: pending,
    };
  }

  /**
   * Apply a safe, non-secret configuration change.
   * Policy-checked, validated, audited, verified after application.
   * Secret keys are rejected — they must go through CredentialManager.
   */
  async applySafeConfiguration(
    key: string,
    value: string,
    reason: string
  ): Promise<{ success: boolean; verified: boolean; error?: string }> {
    // Secret keys are NEVER managed here
    if (this.config.isSecretKey(key)) {
      return {
        success: false,
        verified: false,
        error: `Secret keys must be managed through CredentialManager, not the control plane bridge`,
      };
    }

    const result = this.config.set(key, value, 'hydi:cognitive-core', reason);
    return {
      success: result.success,
      verified: result.verified,
      error: result.error,
    };
  }

  /**
   * Run the autonomous preflight loop.
   *
   * Behavior:
   *   1. Run preflight
   *   2. If BLOCKED, classify each blocker
   *   3. Resolve AUTO_RESOLVABLE blockers
   *   4. Verify resolution
   *   5. Rerun preflight
   *   6. Repeat until READY, OPERATOR_INPUT_REQUIRED, HUMAN_AUTHORIZATION_REQUIRED,
   *      PROHIBITED, or MAX_ATTEMPTS_EXCEEDED
   *
   * Bounded by maxAttempts (default 5). Never creates an infinite loop.
   * Every resolution attempt is audited and correlated.
   *
   * FINANCIAL SAFETY: This method NEVER creates a transaction authorization.
   * READY means "operationally ready" — it does NOT mean "authorized to transact".
   */
  async runAutonomousPreflight(maxAttempts: number = 5): Promise<{
    finalState: 'READY' | 'BLOCKED' | 'FAILED' | 'OPERATOR_INPUT_REQUIRED' | 'HUMAN_AUTHORIZATION_REQUIRED' | 'PROHIBITED' | 'MAX_ATTEMPTS_EXCEEDED';
    attempts: number;
    preflightResults: PreflightResult[];
    resolutionResults: BlockerResolutionResult[];
    transactionPermission: string;
    summary: string;
  }> {
    const preflightResults: PreflightResult[] = [];
    const resolutionResults: BlockerResolutionResult[] = [];
    let attempt = 0;
    let lastPreflight: PreflightResult | null = null;

    while (attempt < maxAttempts) {
      attempt++;
      const preflight = await this.runPreflight();
      preflightResults.push(preflight);
      lastPreflight = preflight;

      // If READY, we're done — but NOT authorized to transact
      if (preflight.state === 'READY') {
        return {
          finalState: 'READY',
          attempts: attempt,
          preflightResults,
          resolutionResults,
          transactionPermission: preflight.transactionPermission,
          summary: `READY after ${attempt} attempt(s). ${preflight.summary}`,
        };
      }

      if (preflight.state === 'FAILED') {
        return {
          finalState: 'FAILED',
          attempts: attempt,
          preflightResults,
          resolutionResults,
          transactionPermission: preflight.transactionPermission,
          summary: `FAILED after ${attempt} attempt(s). ${preflight.summary}`,
        };
      }

      // BLOCKED — classify and attempt resolution
      const blockingBlockers = preflight.blockers.filter(b => b.blocks);

      // Check for PROHIBITED blockers
      const prohibited = blockingBlockers.find(b => b.resolution === 'PROHIBITED');
      if (prohibited) {
        return {
          finalState: 'PROHIBITED',
          attempts: attempt,
          preflightResults,
          resolutionResults,
          transactionPermission: 'BLOCKED',
          summary: `PROHIBITED: ${prohibited.code} — ${prohibited.description}`,
        };
      }

      // Check for HUMAN_AUTHORIZATION_REQUIRED blockers
      const humanAuth = blockingBlockers.find(b => b.resolution === 'HUMAN_AUTHORIZATION_REQUIRED');
      if (humanAuth) {
        return {
          finalState: 'HUMAN_AUTHORIZATION_REQUIRED',
          attempts: attempt,
          preflightResults,
          resolutionResults,
          transactionPermission: 'BLOCKED',
          summary: `HUMAN_AUTHORIZATION_REQUIRED: ${humanAuth.code} — ${humanAuth.description}`,
        };
      }

      // Check for OPERATOR_INPUT_REQUIRED blockers
      const operatorInput = blockingBlockers.find(b => b.resolution === 'OPERATOR_INPUT_REQUIRED');
      if (operatorInput) {
        // Still try to resolve any AUTO_RESOLVABLE blockers first
        const autoResolvable = blockingBlockers.filter(b => b.resolution === 'AUTO_RESOLVABLE');
        if (autoResolvable.length > 0) {
          const results = await this.resolveBlockers(autoResolvable);
          resolutionResults.push(...results);
          // Continue to next iteration to rerun preflight
          continue;
        }
        return {
          finalState: 'OPERATOR_INPUT_REQUIRED',
          attempts: attempt,
          preflightResults,
          resolutionResults,
          transactionPermission: 'BLOCKED',
          summary: `OPERATOR_INPUT_REQUIRED: ${operatorInput.code} — ${operatorInput.operatorAction}`,
        };
      }

      // All remaining blockers are AUTO_RESOLVABLE — resolve them
      const autoResolvable = blockingBlockers.filter(b => b.resolution === 'AUTO_RESOLVABLE');
      if (autoResolvable.length === 0) {
        // No blocking blockers but still not READY — shouldn't happen, but break safely
        break;
      }

      const results = await this.resolveBlockers(autoResolvable);
      resolutionResults.push(...results);

      // Check if all resolutions succeeded
      const failed = results.filter(r => !r.resolved);
      if (failed.length > 0) {
        // Some auto-resolvable blockers failed — rerun preflight to get accurate state
        // The loop will continue and may retry
      }

      // Loop continues — rerun preflight
    }

    // Max attempts exceeded
    return {
      finalState: 'MAX_ATTEMPTS_EXCEEDED',
      attempts: attempt,
      preflightResults,
      resolutionResults,
      transactionPermission: lastPreflight?.transactionPermission || 'BLOCKED',
      summary: `MAX_ATTEMPTS_EXCEEDED after ${attempt} attempt(s). ${lastPreflight?.summary || 'No preflight completed.'}`,
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let singleton: ProductionOperationsControlPlane | null = null;

export function getProductionOperationsControlPlane(): ProductionOperationsControlPlane {
  if (!singleton) {
    singleton = new ProductionOperationsControlPlane();
  }
  return singleton;
}
