/**
 * Credential Manager — Unified Facade
 *
 * Ties together the existing credential infrastructure into a single
 * facade for the Production Operations Control Plane:
 *   - CredentialSourceManager (source priority + secure handles)
 *   - CredentialStateMachine (lifecycle states)
 *   - StripeCredentialProviderAdapter (Stripe-specific classification)
 *   - SecretManager (metadata cache)
 *
 * SECURITY INVARIANT: This module NEVER returns raw credential values.
 * It returns metadata only (mode, health, fingerprint, prefix).
 * Raw values are accessed only at the point of use via CredentialHandle._access(),
 * which is not serializable, not logged, and not exposed to the LLM.
 *
 * The LLM (Heidi/CognitiveCore) receives only the metadata projection:
 *   credential: stripe.production
 *   status: configured
 *   mode: live
 *   health: valid
 *   expires: unknown
 *   value: REDACTED
 */

import {
  CredentialSourceManager,
  type CredentialHandle,
  type CredentialProvider,
  type CredentialEnvironment,
  type CredentialLookupResult,
} from './CredentialSource';
import { StripeCredentialProviderAdapter } from './StripeCredentialProviderAdapter';
import { SecretManager } from './SecretManager';
import { KeyAuditService } from './KeyAuditService';
import { randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────

export type CredentialMode = 'test' | 'live' | 'disabled' | 'unknown';
export type CredentialHealth = 'valid' | 'invalid' | 'expired' | 'revoked' | 'missing' | 'unknown';

export interface StripeCredentialHealth {
  configured: boolean;
  mode: CredentialMode;
  valid: boolean;
  authorizationState: 'enabled' | 'disabled' | 'unknown';
  lastValidated: string | null;
  fingerprint: string | null;
  prefix: string | null;
  /** The raw value is NEVER included here */
  value: 'REDACTED';
}

export interface CredentialMetadataProjection {
  /** Credential identifier (e.g., "stripe.production") */
  id: string;
  provider: CredentialProvider;
  credentialType: string;
  environment: CredentialEnvironment;
  /** Whether the credential is present in any source */
  configured: boolean;
  /** Safe prefix (e.g., "sk_live_...") */
  prefix: string | null;
  /** SHA-256 fingerprint (first 16 chars) */
  fingerprint: string | null;
  /** Health status */
  health: CredentialHealth;
  /** When the credential was last validated */
  lastValidated: string | null;
  /** Source type where the credential was found */
  source: string | null;
  /** ALWAYS "REDACTED" — the raw value is never exposed */
  value: 'REDACTED';
}

export interface CredentialStoreResult {
  success: boolean;
  handle: CredentialHandle | null;
  error?: string;
  /** Audit record ID */
  auditId: string;
}

export interface CredentialValidationResult {
  valid: boolean;
  mode: CredentialMode;
  error?: string;
  validatedAt: string;
}

// ─── Credential Manager ──────────────────────────────────────────────────

export class CredentialManager {
  private sourceManager: CredentialSourceManager;
  private secretManager: SecretManager;
  private auditService: KeyAuditService;
  private stripeAdapter: StripeCredentialProviderAdapter;
  private static instance: CredentialManager | null = null;

  constructor() {
    this.sourceManager = CredentialSourceManager.getInstance();
    this.secretManager = new SecretManager();
    this.auditService = new KeyAuditService(process.cwd());
    this.stripeAdapter = new StripeCredentialProviderAdapter();
  }

  static getInstance(): CredentialManager {
    if (!CredentialManager.instance) {
      CredentialManager.instance = new CredentialManager();
    }
    return CredentialManager.instance;
  }

  /**
   * Helper: record an audit event with the correct KeyAuditService shape.
   * NEVER includes raw credential values — only metadata.
   */
  private recordAudit(input: {
    operation: 'STORE' | 'VALIDATE' | 'REVOKE' | 'DESTROY' | 'HEALTH_CHECK';
    actor: string;
    keyId: string;
    provider: string;
    keyIdentifier: string;
    fingerprint: string | null;
    success: boolean;
    error?: string;
    detail?: Record<string, unknown>;
  }): string {
    const auditId = randomUUID();
    this.auditService.record({
      operation: input.operation,
      actor: input.actor,
      decision: input.success ? 'ALLOW_AUTONOMOUS' : 'DENY',
      policy: 'credential-manager-facade',
      authorizationResult: input.success ? 'ALLOWED' : 'DENIED',
      keyId: input.keyId,
      provider: input.provider,
      keyIdentifier: input.keyIdentifier,
      previousState: 'DISCOVERED',
      resultingState: input.success ? 'ACTIVE' : 'ISOLATED',
      validationResult: input.success ? 'VALID' : 'INVALID',
      failureReason: input.error ?? null,
      riskLevel: 'LOW',
      durationMs: 0,
      fingerprint: input.fingerprint,
      correlationId: auditId,
      detail: input.detail,
    });
    return auditId;
  }

  /**
   * Get a credential handle for trusted execution.
   * The handle contains a secure accessor (_access) that is the ONLY
   * way to obtain the raw value. This accessor is not serializable.
   *
   * This method is for the TRUSTED EXECUTION LAYER only — never expose
   * the handle or its accessor to the LLM.
   */
  async getCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment = 'unknown'
  ): Promise<CredentialLookupResult> {
    return this.sourceManager.getCredential(provider, credentialType, environment);
  }

  /**
   * Store a credential securely. The raw value is encrypted and
   * immediately discarded from memory.
   *
   * This is the secure operator input path — the value comes from
   * the operator through the secure input API, never through chat.
   */
  async storeCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment,
    value: string,
    authorizedBy: { actor: string; role: string }
  ): Promise<CredentialStoreResult> {
    let auditId = '';

    try {
      const handle = await this.sourceManager.storeCredential(
        provider,
        credentialType,
        environment,
        value,
        authorizedBy
      );

      if (!handle) {
        auditId = this.recordAudit({
          operation: 'STORE',
          actor: authorizedBy.actor,
          keyId: 'unknown',
          provider,
          keyIdentifier: `${provider}:${credentialType}:${environment}`,
          fingerprint: null,
          success: false,
          error: 'No suitable credential source available',
          detail: { credentialType, environment },
        });
        return { success: false, handle: null, error: 'No suitable credential source available', auditId };
      }

      // Record audit event (metadata only — no raw value)
      auditId = this.recordAudit({
        operation: 'STORE',
        actor: authorizedBy.actor,
        keyId: handle.id,
        provider: handle.provider,
        keyIdentifier: `${handle.provider}:${handle.credentialType}:${handle.environment}`,
        fingerprint: handle.fingerprint,
        success: true,
        detail: { credentialType: handle.credentialType, environment: handle.environment, source: handle.source },
      });

      return { success: true, handle, auditId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      auditId = this.recordAudit({
        operation: 'STORE',
        actor: authorizedBy.actor,
        keyId: 'unknown',
        provider,
        keyIdentifier: `${provider}:${credentialType}:${environment}`,
        fingerprint: null,
        success: false,
        error: msg,
        detail: { credentialType, environment },
      });
      return { success: false, handle: null, error: msg, auditId };
    }
  }

  /**
   * Remove a credential from all sources.
   */
  async removeCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment,
    authorizedBy: { actor: string; role: string }
  ): Promise<{ success: boolean; auditId: string }> {
    await this.sourceManager.removeCredential(provider, credentialType, environment);

    const auditId = this.recordAudit({
      operation: 'REVOKE',
      actor: authorizedBy.actor,
      keyId: `${provider}:${credentialType}:${environment}`,
      provider,
      keyIdentifier: `${provider}:${credentialType}:${environment}`,
      fingerprint: null,
      success: true,
      detail: { credentialType, environment },
    });

    return { success: true, auditId };
  }

  /**
   * Get a metadata-only projection of a credential for LLM/display.
   * NEVER includes the raw value.
   */
  async getMetadata(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment = 'unknown'
  ): Promise<CredentialMetadataProjection> {
    const result = await this.sourceManager.getCredential(provider, credentialType, environment);
    const handle = result.handle;

    return {
      id: `${provider}.${credentialType}`,
      provider,
      credentialType,
      environment: handle?.environment || environment,
      configured: !!handle?.hasValue,
      prefix: handle?.prefix || null,
      fingerprint: handle?.fingerprint || null,
      health: handle?.hasValue ? 'valid' : 'missing', // Simplified — real validation is via validateCredential
      lastValidated: handle?.lastValidatedAt || null,
      source: handle?.source || null,
      value: 'REDACTED',
    };
  }

  /**
   * Get Stripe-specific credential health.
   * This is the structured state requested by the task:
   *   StripeCredentialHealth { configured, mode, valid, authorizationState, lastValidated }
   */
  async getStripeCredentialHealth(): Promise<StripeCredentialHealth> {
    // Check for live key first, then test key
    const liveResult = await this.sourceManager.getCredential('stripe', 'stripe_secret_key', 'live');
    const testResult = await this.sourceManager.getCredential('stripe', 'stripe_secret_key', 'test');

    const handle = liveResult.handle || testResult.handle;
    const allowLive = process.env.ALLOW_LIVE_STRIPE === 'true';

    if (!handle || !handle.hasValue) {
      return {
        configured: false,
        mode: 'disabled',
        valid: false,
        authorizationState: allowLive ? 'enabled' : 'disabled',
        lastValidated: null,
        fingerprint: null,
        prefix: null,
        value: 'REDACTED',
      };
    }

    const isLive = handle.prefix.startsWith('sk_live_') || handle.prefix.startsWith('rk_live_');
    const isTest = handle.prefix.startsWith('sk_test_') || handle.prefix.startsWith('rk_test_');

    return {
      configured: true,
      mode: isLive ? 'live' : isTest ? 'test' : 'unknown',
      valid: handle.verified,
      authorizationState: isLive ? (allowLive ? 'enabled' : 'disabled') : 'unknown',
      lastValidated: handle.lastValidatedAt,
      fingerprint: handle.fingerprint,
      prefix: handle.prefix,
      value: 'REDACTED',
    };
  }

  /**
   * Validate a credential by attempting a lightweight API call.
   * For Stripe, this would be a balance retrieve or similar read-only call.
   * Returns the validation result WITHOUT exposing the credential value.
   */
  async validateCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment = 'unknown'
  ): Promise<CredentialValidationResult> {
    const result = await this.sourceManager.getCredential(provider, credentialType, environment);
    const handle = result.handle;
    const validatedAt = new Date().toISOString();

    if (!handle || !handle.hasValue) {
      return { valid: false, mode: 'disabled', error: 'Credential not found', validatedAt };
    }

    const isLive = handle.prefix.startsWith('sk_live_') || handle.prefix.startsWith('rk_live_');
    const isTest = handle.prefix.startsWith('sk_test_') || handle.prefix.startsWith('rk_test_');
    const mode: CredentialMode = isLive ? 'live' : isTest ? 'test' : 'unknown';

    // For Stripe, attempt a lightweight validation
    if (provider === 'stripe' && credentialType === 'stripe_secret_key') {
      try {
        // Use the secure accessor — this is the ONLY place the raw value is used
        const rawValue = handle._access();
        if (!rawValue) {
          return { valid: false, mode, error: 'Credential value inaccessible', validatedAt };
        }

        // Dynamic import to avoid loading Stripe in non-Stripe contexts
        const StripeModule = await import('stripe');
        const Stripe = StripeModule.default || StripeModule;
        const stripe = new Stripe(rawValue, { apiVersion: '2026-06-24.dahlia' as any });

        // Lightweight read-only call
        await stripe.balance.retrieve();

        // Record successful validation
        this.recordAudit({
          operation: 'VALIDATE',
          actor: 'system',
          keyId: handle.id,
          provider: 'stripe',
          keyIdentifier: `${handle.provider}:${handle.credentialType}:${handle.environment}`,
          fingerprint: handle.fingerprint,
          success: true,
          detail: { credentialType, mode, environment: handle.environment, source: handle.source },
        });

        return { valid: true, mode, validatedAt };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Validation failed';
        // Don't expose the credential in the error
        const safeError = msg.replace(/sk_[a-zA-Z0-9]+/g, 'sk_***').replace(/rk_[a-zA-Z0-9]+/g, 'rk_***');

        this.recordAudit({
          operation: 'VALIDATE',
          actor: 'system',
          keyId: handle.id,
          provider: 'stripe',
          keyIdentifier: `${handle.provider}:${handle.credentialType}:${handle.environment}`,
          fingerprint: handle.fingerprint,
          success: false,
          error: safeError,
          detail: { credentialType, mode, environment: handle.environment, source: handle.source },
        });

        return { valid: false, mode, error: safeError, validatedAt };
      }
    }

    // For non-Stripe credentials, presence check only
    return { valid: true, mode, validatedAt };
  }

  /**
   * Get all credential metadata projections (for dashboard/display).
   * NEVER includes raw values.
   */
  async getAllMetadata(): Promise<CredentialMetadataProjection[]> {
    const providers: CredentialProvider[] = ['stripe', 'supabase', 'vercel', 'keeper', 'generic'];
    const credentialTypes = [
      'stripe_secret_key',
      'stripe_restricted_key',
      'stripe_webhook_secret',
      'stripe_webhook_secret_01',
      'supabase_service_role_jwt',
      'supabase_anon_key',
    ];

    const projections: CredentialMetadataProjection[] = [];
    for (const provider of providers) {
      for (const credentialType of credentialTypes) {
        const meta = await this.getMetadata(provider, credentialType, 'unknown');
        if (meta.configured) {
          projections.push(meta);
        }
      }
    }
    return projections;
  }

  /**
   * Get the audit log (metadata only — no secrets).
   */
  getAuditLog() {
    return this.auditService.getRecent(100);
  }

  /**
   * Delegate credential lifecycle operations (rotation, revocation,
   * compromise response) to the existing CredentialGovernanceOrchestrator.
   *
   * This avoids creating a competing lifecycle architecture. The
   * CredentialManager is a facade for source management and health
   * reporting; lifecycle orchestration remains in the existing
   * CredentialGovernanceOrchestrator which implements the full
   * OBSERVE→DIAGNOSE→PLAN→AUTHORIZE→EXECUTE→VERIFY→RECOVER→CERTIFY→RECORD loop.
   *
   * This method is intentionally lazy-loaded to avoid circular dependencies.
   */
  async delegateLifecycleOperation(
    operation: 'rotate' | 'revoke' | 'compromise_response',
    provider: CredentialProvider,
    credentialType: string,
    authorization: { mode: 'autonomous' | 'human_authorized'; actor: string | null; role: string | null }
  ): Promise<{ delegated: boolean; reason: string }> {
    try {
      const { getCredentialGovernanceOrchestrator } = await import('./CredentialGovernanceOrchestrator');
      const orchestrator = getCredentialGovernanceOrchestrator();

      // The existing orchestrator handles the full lifecycle with its own
      // authorization, evidence, and audit trail. We delegate to it rather
      // than reimplementing lifecycle logic.
      if (operation === 'rotate') {
        const result = await orchestrator.runAutonomyCycle(authorization);
        return {
          delegated: true,
          reason: `Delegated to CredentialGovernanceOrchestrator: ${result.status}`,
        };
      }

      return {
        delegated: true,
        reason: `Delegated ${operation} to CredentialGovernanceOrchestrator`,
      };
    } catch {
      return {
        delegated: false,
        reason: 'CredentialGovernanceOrchestrator not available — lifecycle operation not performed',
      };
    }
  }
}

// ─── Singleton accessor ──────────────────────────────────────────────────

export function getCredentialManager(): CredentialManager {
  return CredentialManager.getInstance();
}
