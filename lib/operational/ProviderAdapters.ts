/**
 * Provider Adapter Architecture
 *
 * Each external provider has an adapter that knows how to:
 *   - Discover account state (do we have an account? is it configured?)
 *   - Discover missing credentials (what env vars are needed?)
 *   - Validate credentials (call the provider API to check validity)
 *   - Verify capability (call a safe, low-risk API operation)
 *
 * Provider-specific behavior is isolated here, not in the governance engine.
 *
 * IMPORTANT: Adapters NEVER create accounts, accept terms, or enter payment
 * details. Those are R3 actions that require human authorization. Adapters
 * only handle the technical verification and configuration steps that come
 * AFTER the human has created the account and obtained credentials.
 */

import type {
  CredentialState,
  CapabilityBlocker,
  ExternalCommitmentType,
  AuthorizationLevel,
} from './CapabilityAcquisitionTypes';
import type { CredentialMetadata } from './SecretManager';

// ─── Provider Adapter Interface ───────────────────────────────────────────

export interface ProviderAdapter {
  /** Provider identifier (e.g., 'stripe', 'gmail', 'google_places', 'twilio') */
  readonly providerId: string;

  /** Human-readable provider name */
  readonly displayName: string;

  /** The capability ID this adapter serves */
  readonly capabilityId: string;

  /** Environment variables this provider needs */
  readonly requiredEnvVars: string[];

  /**
   * Discover the current account/credential state.
   * Returns structured information about what's missing and why.
   */
  discoverAccountState(): Promise<AccountStateResult>;

  /**
   * Discover which specific credentials are missing.
   */
  discoverMissingCredentials(): string[];

  /**
   * Validate that present credentials are actually valid by calling
   * the provider API. Returns the credential state.
   */
  validateCredential(): Promise<CredentialValidationResult>;

  /**
   * Verify the capability works by calling a safe, low-risk API operation.
   * This is the operation that must pass before a capability is marked READY.
   */
  verifyCapability(): Promise<VerificationResult>;

  /**
   * Get the acquisition plan for this provider.
   * Describes what steps are needed to acquire this capability.
   */
  getAcquisitionPlan(): ProviderAcquisitionPlan;
}

export interface AccountStateResult {
  /** Does the account exist? (null = can't determine) */
  accountExists: boolean | null;
  /** Are credentials present in the environment? */
  credentialsPresent: boolean;
  /** Are credentials valid (verified against provider API)? */
  credentialsValid: boolean | null;
  /** What's blocking this capability? */
  blocker: CapabilityBlocker;
  /** Human-readable explanation */
  evidence: string;
  /** What env vars are missing (if any) */
  missingEnvVars: string[];
}

export interface CredentialValidationResult {
  state: CredentialState;
  evidence: string;
  latencyMs: number;
  /** Provider API response code (if applicable) */
  apiResponseCode?: number;
}

export interface VerificationResult {
  verified: boolean;
  evidence: string;
  latencyMs: number;
  /** The specific operation that was tested */
  operation: string;
  /** Error message if verification failed (sanitized, no secrets) */
  error?: string;
}

export interface ProviderAcquisitionPlan {
  provider: string;
  capabilityId: string;
  /** Steps that HEIDI can do autonomously */
  autonomousSteps: string[];
  /** Steps that require human action (account creation, ToS, payment) */
  humanRequiredSteps: string[];
  /** Steps that require owner authorization (resource creation) */
  ownerAuthorizationSteps: string[];
  /** The commitment types this acquisition involves */
  commitmentTypes: ExternalCommitmentType[];
  /** Required authorization level */
  requiredAuthorization: AuthorizationLevel;
  /** Whether this involves financial commitment */
  financialCommitment: boolean;
  /** Whether this requires accepting legal terms */
  legalAcceptance: boolean;
  /** Whether this requires identity verification */
  identityVerification: boolean;
}

// ─── Abstract Base Adapter ────────────────────────────────────────────────

/**
 * Base class with common functionality for all provider adapters.
 * Handles env var checking, fingerprinting, and common patterns.
 */
export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly providerId: string;
  abstract readonly displayName: string;
  abstract readonly capabilityId: string;
  abstract readonly requiredEnvVars: string[];

  discoverMissingCredentials(): string[] {
    return this.requiredEnvVars.filter((v) => !process.env[v]);
  }

  async discoverAccountState(): Promise<AccountStateResult> {
    const missing = this.discoverMissingCredentials();

    if (missing.length > 0) {
      return {
        accountExists: null, // Can't determine without credentials
        credentialsPresent: false,
        credentialsValid: null,
        blocker: 'MISSING_CREDENTIAL',
        evidence: `Missing credentials: ${missing.join(', ')}`,
        missingEnvVars: missing,
      };
    }

    // Credentials are present — validate them
    const validation = await this.validateCredential();

    let blocker: CapabilityBlocker = 'UNKNOWN';
    if (validation.state === 'VALID') {
      blocker = 'UNKNOWN'; // No blocker — will be verified next
    } else if (validation.state === 'INVALID') {
      blocker = 'INVALID_CREDENTIAL';
    } else if (validation.state === 'EXPIRED') {
      blocker = 'EXPIRED_CREDENTIAL';
    } else if (validation.state === 'REVOKED') {
      blocker = 'REVOKED_CREDENTIAL';
    } else if (validation.state === 'PRESENT') {
      blocker = 'CREDENTIAL_PRESENT_UNVERIFIED';
    }

    return {
      accountExists: validation.state !== 'INVALID',
      credentialsPresent: true,
      credentialsValid: validation.state === 'VALID',
      blocker,
      evidence: validation.evidence,
      missingEnvVars: [],
    };
  }

  abstract validateCredential(): Promise<CredentialValidationResult>;
  abstract verifyCapability(): Promise<VerificationResult>;
  abstract getAcquisitionPlan(): ProviderAcquisitionPlan;

  /**
   * Helper: check if all required env vars are present.
   */
  protected hasAllCredentials(): boolean {
    return this.requiredEnvVars.every((v) => process.env[v]);
  }

  /**
   * Helper: create a timeout-bounded fetch.
   */
  protected async fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Gmail/SMTP Adapter ───────────────────────────────────────────────────

export class GmailAdapter extends BaseProviderAdapter {
  readonly providerId = 'gmail';
  readonly displayName = 'Gmail SMTP';
  readonly capabilityId = 'commercial.email';
  readonly requiredEnvVars: string[];

  constructor() {
    super();
    // SMTP can use either SENDGRID_API_KEY or SMTP_* vars
    this.requiredEnvVars = ['SENDGRID_API_KEY']; // Primary
  }

  async validateCredential(): Promise<CredentialValidationResult> {
    const start = Date.now();
    const hasSendGrid = !!process.env.SENDGRID_API_KEY;
    const hasSMTP = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);

    if (!hasSendGrid && !hasSMTP) {
      return {
        state: 'ABSENT',
        evidence: 'No email credentials configured (neither SENDGRID_API_KEY nor SMTP_* vars present)',
        latencyMs: Date.now() - start,
      };
    }

    // If SendGrid is configured, validate via API
    if (hasSendGrid) {
      try {
        const response = await this.fetchWithTimeout('https://api.sendgrid.com/v3/user/account', {
          headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}` },
        });

        if (response.ok) {
          return {
            state: 'VALID',
            evidence: 'SendGrid API verified — account accessible',
            latencyMs: Date.now() - start,
            apiResponseCode: response.status,
          };
        }

        if (response.status === 401) {
          return { state: 'INVALID', evidence: 'SendGrid API key rejected (401)', latencyMs: Date.now() - start, apiResponseCode: 401 };
        }
        if (response.status === 403) {
          return { state: 'REVOKED', evidence: 'SendGrid API key forbidden (403)', latencyMs: Date.now() - start, apiResponseCode: 403 };
        }

        return { state: 'UNKNOWN', evidence: `SendGrid API returned ${response.status}`, latencyMs: Date.now() - start, apiResponseCode: response.status };
      } catch (error) {
        return { state: 'UNKNOWN', evidence: `SendGrid API unreachable: ${error instanceof Error ? error.message : 'unknown'}`, latencyMs: Date.now() - start };
      }
    }

    // If SMTP is configured, validate by connecting to the SMTP server
    if (hasSMTP) {
      try {
        const net = await import('net');
        const host = process.env.SMTP_HOST!;
        const port = parseInt(process.env.SMTP_PORT!, 10);

        return await new Promise<CredentialValidationResult>((resolve) => {
          const socket = new net.Socket();
          const timeout = setTimeout(() => {
            socket.destroy();
            resolve({
              state: 'UNKNOWN',
              evidence: `SMTP connection to ${host}:${port} timed out`,
              latencyMs: Date.now() - start,
            });
          }, 10000);

          socket.connect(port, host, () => {
            clearTimeout(timeout);
            // Read the SMTP greeting
            socket.once('data', (data) => {
              socket.destroy();
              const greeting = data.toString().substring(0, 100);
              const isSmtpGreeting = greeting.startsWith('220');
              resolve({
                state: isSmtpGreeting ? 'VALID' : 'UNKNOWN',
                evidence: `SMTP server reachable at ${host}:${port} — greeting: ${greeting.trim()}`,
                latencyMs: Date.now() - start,
              });
            });
          });

          socket.on('error', (err) => {
            clearTimeout(timeout);
            socket.destroy();
            resolve({
              state: 'INVALID',
              evidence: `SMTP connection to ${host}:${port} failed: ${err.message}`,
              latencyMs: Date.now() - start,
            });
          });
        });
      } catch (error) {
        return { state: 'UNKNOWN', evidence: `SMTP check failed: ${error instanceof Error ? error.message : 'unknown'}`, latencyMs: Date.now() - start };
      }
    }

    return { state: 'ABSENT', evidence: 'No email credentials', latencyMs: Date.now() - start };
  }

  async verifyCapability(): Promise<VerificationResult> {
    const validation = await this.validateCredential();
    if (validation.state !== 'VALID') {
      return {
        verified: false,
        evidence: validation.evidence,
        latencyMs: validation.latencyMs,
        operation: 'smtp_connectivity',
        error: `Credential state: ${validation.state}`,
      };
    }

    // For SMTP: connectivity check IS the verification
    // For SendGrid: the API account check IS the verification
    return {
      verified: true,
      evidence: validation.evidence,
      latencyMs: validation.latencyMs,
      operation: 'smtp_connectivity',
    };
  }

  getAcquisitionPlan(): ProviderAcquisitionPlan {
    return {
      provider: 'gmail',
      capabilityId: 'commercial.email',
      autonomousSteps: [
        'Check if SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS are set',
        'Validate SMTP connectivity by connecting to the server',
        'Record credential fingerprint',
        'Update capability health to READY',
      ],
      humanRequiredSteps: [
        'Enable 2-Step Verification on Google Account',
        'Generate an app password for Mail',
        'Add SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=email@gmail.com, SMTP_PASS=app-password to .env.local',
      ],
      ownerAuthorizationSteps: [],
      commitmentTypes: ['CREDENTIAL_PROVISIONING', 'CONFIGURATION_CHANGE'],
      requiredAuthorization: 'R1',
      financialCommitment: false,
      legalAcceptance: false,
      identityVerification: false,
    };
  }
}

// ─── Stripe Adapter ───────────────────────────────────────────────────────

export class StripeAdapter extends BaseProviderAdapter {
  readonly providerId = 'stripe';
  readonly displayName = 'Stripe (Test Mode)';
  readonly capabilityId = 'commercial.stripe';
  readonly requiredEnvVars = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];

  async validateCredential(): Promise<CredentialValidationResult> {
    const start = Date.now();

    if (!this.hasAllCredentials()) {
      return {
        state: 'ABSENT',
        evidence: `Missing: ${this.discoverMissingCredentials().join(', ')}`,
        latencyMs: Date.now() - start,
      };
    }

    try {
      const key = process.env.STRIPE_SECRET_KEY!;
      const response = await this.fetchWithTimeout('https://api.stripe.com/v1/balance', {
        headers: { 'Authorization': `Bearer ${key}` },
      });

      if (response.ok) {
        const balance = await response.json() as { available?: { amount: number; currency?: string }[] };
        const amt = balance.available?.[0]?.amount ?? 0;
        const cur = balance.available?.[0]?.currency || 'usd';
        return {
          state: 'VALID',
          evidence: `Stripe API verified — balance: ${amt / 100} ${cur}`,
          latencyMs: Date.now() - start,
          apiResponseCode: response.status,
        };
      }

      if (response.status === 401) {
        return { state: 'INVALID', evidence: 'Stripe API key rejected (401)', latencyMs: Date.now() - start, apiResponseCode: 401 };
      }
      if (response.status === 403) {
        return { state: 'REVOKED', evidence: 'Stripe API key forbidden (403) — account may be restricted', latencyMs: Date.now() - start, apiResponseCode: 403 };
      }

      return { state: 'UNKNOWN', evidence: `Stripe API returned ${response.status}`, latencyMs: Date.now() - start, apiResponseCode: response.status };
    } catch (error) {
      return { state: 'UNKNOWN', evidence: `Stripe API unreachable: ${error instanceof Error ? error.message : 'unknown'}`, latencyMs: Date.now() - start };
    }
  }

  async verifyCapability(): Promise<VerificationResult> {
    const validation = await this.validateCredential();
    return {
      verified: validation.state === 'VALID',
      evidence: validation.evidence,
      latencyMs: validation.latencyMs,
      operation: 'stripe.balance.retrieve',
      error: validation.state !== 'VALID' ? `Credential state: ${validation.state}` : undefined,
    };
  }

  getAcquisitionPlan(): ProviderAcquisitionPlan {
    return {
      provider: 'stripe',
      capabilityId: 'commercial.stripe',
      autonomousSteps: [
        'Check if STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set',
        'Validate key by calling GET /v1/balance',
        'Record credential fingerprint',
        'Update capability health to READY',
      ],
      humanRequiredSteps: [
        'Create a Stripe account at dashboard.stripe.com/register',
        'Toggle to Test mode',
        'Copy the Secret key (sk_test_...) from Developers → API keys',
        'Create a webhook endpoint and copy the signing secret (whsec_...)',
        'Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to .env.local',
      ],
      ownerAuthorizationSteps: [],
      commitmentTypes: ['ACCOUNT_CREATION', 'CREDENTIAL_PROVISIONING', 'CONFIGURATION_CHANGE'],
      requiredAuthorization: 'R3',
      financialCommitment: false, // Test mode is free
      legalAcceptance: true, // Stripe ToS
      identityVerification: false,
    };
  }
}

// ─── Google Places Adapter ────────────────────────────────────────────────

export class GooglePlacesAdapter extends BaseProviderAdapter {
  readonly providerId = 'google_places';
  readonly displayName = 'Google Places API';
  readonly capabilityId = 'commercial.discovery_external';
  readonly requiredEnvVars = ['GOOGLE_PLACES_API_KEY'];

  async validateCredential(): Promise<CredentialValidationResult> {
    const start = Date.now();

    if (!this.hasAllCredentials()) {
      return {
        state: 'ABSENT',
        evidence: 'Missing: GOOGLE_PLACES_API_KEY',
        latencyMs: Date.now() - start,
      };
    }

    try {
      const key = process.env.GOOGLE_PLACES_API_KEY!;
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=40.7128,-74.0060&radius=100&type=cafe&key=${key}`;
      const response = await this.fetchWithTimeout(url);

      if (response.ok) {
        const data = await response.json() as { status?: string; results?: unknown[] };
        if (data.status === 'OK') {
          return {
            state: 'VALID',
            evidence: `Google Places API verified — returned ${data.results?.length || 0} results`,
            latencyMs: Date.now() - start,
            apiResponseCode: response.status,
          };
        }
        if (data.status === 'REQUEST_DENIED') {
          return { state: 'INVALID', evidence: 'Google Places API key rejected (REQUEST_DENIED)', latencyMs: Date.now() - start, apiResponseCode: response.status };
        }
        if (data.status === 'OVER_QUERY_LIMIT') {
          return { state: 'REVOKED', evidence: 'Google Places API rate limit exceeded', latencyMs: Date.now() - start, apiResponseCode: response.status };
        }
        return { state: 'UNKNOWN', evidence: `Google Places API status: ${data.status}`, latencyMs: Date.now() - start, apiResponseCode: response.status };
      }

      return { state: 'UNKNOWN', evidence: `Google Places API returned HTTP ${response.status}`, latencyMs: Date.now() - start, apiResponseCode: response.status };
    } catch (error) {
      return { state: 'UNKNOWN', evidence: `Google Places API unreachable: ${error instanceof Error ? error.message : 'unknown'}`, latencyMs: Date.now() - start };
    }
  }

  async verifyCapability(): Promise<VerificationResult> {
    const validation = await this.validateCredential();
    return {
      verified: validation.state === 'VALID',
      evidence: validation.evidence,
      latencyMs: validation.latencyMs,
      operation: 'google_places.nearby_search',
      error: validation.state !== 'VALID' ? `Credential state: ${validation.state}` : undefined,
    };
  }

  getAcquisitionPlan(): ProviderAcquisitionPlan {
    return {
      provider: 'google_places',
      capabilityId: 'commercial.discovery_external',
      autonomousSteps: [
        'Check if GOOGLE_PLACES_API_KEY is set',
        'Validate key by calling Places Nearby Search API',
        'Record credential fingerprint',
        'Update capability health to READY',
      ],
      humanRequiredSteps: [
        'Create a Google Cloud project at console.cloud.google.com',
        'Enable billing (requires a card) and set a budget cap',
        'Enable the Places API',
        'Create and restrict an API key',
        'Add GOOGLE_PLACES_API_KEY to .env.local',
      ],
      ownerAuthorizationSteps: [],
      commitmentTypes: ['ACCOUNT_CREATION', 'FINANCIAL', 'LEGAL', 'CREDENTIAL_PROVISIONING', 'CONFIGURATION_CHANGE'],
      requiredAuthorization: 'R3',
      financialCommitment: true, // Requires card on file
      legalAcceptance: true, // Google Cloud ToS
      identityVerification: false,
    };
  }
}

// ─── Twilio Adapter ───────────────────────────────────────────────────────

export class TwilioAdapter extends BaseProviderAdapter {
  readonly providerId = 'twilio';
  readonly displayName = 'Twilio SMS';
  readonly capabilityId = 'commercial.sms';
  readonly requiredEnvVars = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'];

  async validateCredential(): Promise<CredentialValidationResult> {
    const start = Date.now();

    if (!this.hasAllCredentials()) {
      return {
        state: 'ABSENT',
        evidence: `Missing: ${this.discoverMissingCredentials().join(', ')}`,
        latencyMs: Date.now() - start,
      };
    }

    try {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const token = process.env.TWILIO_AUTH_TOKEN!;
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');

      const response = await this.fetchWithTimeout(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`,
        { headers: { 'Authorization': `Basic ${auth}` } },
      );

      if (response.ok) {
        const data = await response.json() as { balance?: string; currency?: string };
        return {
          state: 'VALID',
          evidence: `Twilio API verified — balance: ${data.balance} ${data.currency || 'USD'}`,
          latencyMs: Date.now() - start,
          apiResponseCode: response.status,
        };
      }

      if (response.status === 401) {
        return { state: 'INVALID', evidence: 'Twilio credentials rejected (401)', latencyMs: Date.now() - start, apiResponseCode: 401 };
      }
      if (response.status === 403) {
        return { state: 'REVOKED', evidence: 'Twilio account suspended (403)', latencyMs: Date.now() - start, apiResponseCode: 403 };
      }

      return { state: 'UNKNOWN', evidence: `Twilio API returned ${response.status}`, latencyMs: Date.now() - start, apiResponseCode: response.status };
    } catch (error) {
      return { state: 'UNKNOWN', evidence: `Twilio API unreachable: ${error instanceof Error ? error.message : 'unknown'}`, latencyMs: Date.now() - start };
    }
  }

  async verifyCapability(): Promise<VerificationResult> {
    const validation = await this.validateCredential();
    return {
      verified: validation.state === 'VALID',
      evidence: validation.evidence,
      latencyMs: validation.latencyMs,
      operation: 'twilio.balance.retrieve',
      error: validation.state !== 'VALID' ? `Credential state: ${validation.state}` : undefined,
    };
  }

  getAcquisitionPlan(): ProviderAcquisitionPlan {
    return {
      provider: 'twilio',
      capabilityId: 'commercial.sms',
      autonomousSteps: [
        'Check if TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER are set',
        'Validate credentials by calling Balance API',
        'Record credential fingerprint',
        'Update capability health to READY',
      ],
      humanRequiredSteps: [
        'Create a Twilio account at twilio.com/try-twilio',
        'Get a trial phone number',
        'Copy Account SID and Auth Token',
        'Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER to .env.local',
      ],
      ownerAuthorizationSteps: [],
      commitmentTypes: ['ACCOUNT_CREATION', 'LEGAL', 'CREDENTIAL_PROVISIONING', 'CONFIGURATION_CHANGE'],
      requiredAuthorization: 'R3',
      financialCommitment: false, // Trial credit first
      legalAcceptance: true, // Twilio ToS
      identityVerification: true, // Phone verification required
    };
  }
}

// ─── Adapter Registry ─────────────────────────────────────────────────────

export class ProviderAdapterRegistry {
  private adapters: Map<string, ProviderAdapter> = new Map();

  constructor() {
    this.register(new GmailAdapter());
    this.register(new StripeAdapter());
    this.register(new GooglePlacesAdapter());
    this.register(new TwilioAdapter());
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.capabilityId, adapter);
  }

  getAdapter(capabilityId: string): ProviderAdapter | null {
    return this.adapters.get(capabilityId) || null;
  }

  getAdapterByProvider(providerId: string): ProviderAdapter | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.providerId === providerId) return adapter;
    }
    return null;
  }

  getAllAdapters(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }
}

let registryInstance: ProviderAdapterRegistry | null = null;

export function getProviderAdapterRegistry(): ProviderAdapterRegistry {
  if (!registryInstance) {
    registryInstance = new ProviderAdapterRegistry();
  }
  return registryInstance;
}
