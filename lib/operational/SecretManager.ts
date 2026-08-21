/**
 * SecretManager — HEIDI's secret management abstraction.
 *
 * SECURITY INVARIANT: This module stores metadata about credentials
 * (fingerprints, presence, validity) but NEVER stores, logs, or returns
 * plaintext credential values. Only SHA-256 fingerprints (first 16 hex
 * chars) are ever exposed.
 *
 * Per SECURITY_PROTOCOL.md:
 *   - Secrets are BOUNDARIES, not CONFIG values
 *   - Verify presence, not value
 *   - Log operations, not secrets
 *
 * The in-memory cache stores verification results so the system does not
 * need to re-call provider APIs every cycle. The cache holds metadata
 * only — never the raw credential value.
 */

import { createHash } from 'crypto';
import type { CredentialState, CapabilityBlocker } from './CapabilityAcquisitionTypes';

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Metadata describing a credential's status.
 *
 * IMPORTANT: `fingerprint` is a SHA-256 hash (first 16 hex chars) of the
 * credential value. It is safe to log and compare. The actual value is
 * NEVER included in this structure or any derivative of it.
 */
export interface CredentialMetadata {
  /** The environment variable name this credential is bound to */
  envVar: string;
  /** Whether the env var is present in process.env */
  present: boolean;
  /** Fine-grained credential state (ABSENT, PRESENT, VALID, INVALID, ...) */
  state: CredentialState;
  /** SHA-256 hash of the value (first 16 hex chars), or null if absent */
  fingerprint: string | null;
  /** ISO timestamp of the last successful API verification, or null */
  lastVerified: string | null;
  /** ISO timestamp of the last presence check, or null if never checked */
  lastChecked: string | null;
  /** The provider this credential belongs to (e.g. 'stripe', 'sendgrid') */
  provider: string;
  /** The capability ID this credential gates (e.g. 'commercial.stripe') */
  capabilityId: string;
}

/**
 * A redacted, safe-to-log projection of credential metadata.
 * Contains no sensitive information whatsoever.
 */
export interface RedactedCredentialMetadata {
  envVar: string;
  present: boolean;
  state: CredentialState;
  hasFingerprint: boolean;
  lastVerified: string | null;
  lastChecked: string | null;
  provider: string;
  capabilityId: string;
}

/**
 * An audit-safe record. Includes the fingerprint (hash only) for
 * correlation purposes, but never the credential value.
 */
export interface CredentialAuditRecord {
  envVar: string;
  present: boolean;
  state: CredentialState;
  fingerprint: string | null;
  lastVerified: string | null;
  lastChecked: string | null;
  provider: string;
  capabilityId: string;
  recordedAt: string;
}

// ─── Provider/Capability mapping ──────────────────────────────────────────

/**
 * Maps env var names to their provider and capability ID.
 * This allows SecretManager to populate metadata fields without callers
 * having to pass provider/capabilityId on every call.
 *
 * If an env var is not in this map, provider defaults to 'unknown' and
 * capabilityId defaults to 'unknown'.
 */
const ENV_VAR_MAPPING: Record<string, { provider: string; capabilityId: string }> = {
  STRIPE_SECRET_KEY: { provider: 'stripe', capabilityId: 'commercial.stripe' },
  STRIPE_WEBHOOK_SECRET: { provider: 'stripe', capabilityId: 'commercial.stripe' },
  SENDGRID_API_KEY: { provider: 'sendgrid', capabilityId: 'commercial.email' },
  SMTP_HOST: { provider: 'smtp', capabilityId: 'commercial.email' },
  SMTP_PORT: { provider: 'smtp', capabilityId: 'commercial.email' },
  SMTP_USER: { provider: 'smtp', capabilityId: 'commercial.email' },
  SMTP_PASS: { provider: 'smtp', capabilityId: 'commercial.email' },
  GOOGLE_PLACES_API_KEY: { provider: 'google_places', capabilityId: 'commercial.discovery_external' },
  TWILIO_ACCOUNT_SID: { provider: 'twilio', capabilityId: 'commercial.sms' },
  TWILIO_AUTH_TOKEN: { provider: 'twilio', capabilityId: 'commercial.sms' },
  TWILIO_PHONE_NUMBER: { provider: 'twilio', capabilityId: 'commercial.sms' },
};

// ─── SecretManager ────────────────────────────────────────────────────────

export class SecretManager {
  /**
   * In-memory cache of verification results keyed by env var name.
   *
   * This cache stores METADATA ONLY — never the raw credential value.
   * It allows the system to avoid re-calling provider APIs every cycle
   * by remembering the last-known verification state.
   */
  private readonly metadataCache: Map<string, CredentialMetadata> = new Map();

  /**
   * Get metadata for a single credential.
   *
   * Checks process.env for presence, computes a fingerprint (SHA-256,
   * first 16 hex chars) if present, and returns full metadata.
   *
   * SECURITY: This method NEVER returns the credential value. Only the
   * fingerprint (hash) is included in the result.
   *
   * If a cached verification result exists, it is merged into the
   * returned metadata so callers see the most recent known state.
   */
  getCredentialMetadata(envVar: string): CredentialMetadata {
    const now = new Date().toISOString();
    const mapping = ENV_VAR_MAPPING[envVar] ?? { provider: 'unknown', capabilityId: 'unknown' };
    const rawValue = process.env[envVar];
    const present = typeof rawValue === 'string' && rawValue.length > 0;

    // Compute fingerprint only if present — never store the raw value.
    const fingerprint = present ? this.computeFingerprint(rawValue!) : null;

    // Determine state: use cached verification state if available and the
    // fingerprint hasn't changed; otherwise derive from presence.
    const cached = this.metadataCache.get(envVar);
    let state: CredentialState;

    if (cached && cached.fingerprint === fingerprint) {
      // Same credential as last time — preserve verification state.
      state = cached.state;
    } else if (present) {
      // New or changed credential — mark as PRESENT (unverified).
      state = 'PRESENT';
    } else {
      state = 'ABSENT';
    }

    const metadata: CredentialMetadata = {
      envVar,
      present,
      state,
      fingerprint,
      lastVerified: cached?.lastVerified ?? null,
      lastChecked: now,
      provider: mapping.provider,
      capabilityId: mapping.capabilityId,
    };

    // Update cache with the fresh presence check, preserving verification
    // info if the fingerprint is unchanged.
    this.metadataCache.set(envVar, metadata);

    return metadata;
  }

  /**
   * Get metadata for multiple credentials at once.
   * Convenience wrapper around getCredentialMetadata.
   */
  getMultipleMetadata(envVars: string[]): CredentialMetadata[] {
    return envVars.map((v) => this.getCredentialMetadata(v));
  }

  /**
   * Compute a SHA-256 fingerprint of a credential value.
   *
   * Returns the first 16 hex characters of the hash. This is sufficient
   * for change detection and correlation while keeping the output compact.
   *
   * SECURITY: The input value is never stored. Only the hash is returned.
   * The caller should not retain the input value after calling this.
   *
   * @param value - The plaintext credential value (not stored, not logged)
   * @returns First 16 hex chars of the SHA-256 hash
   */
  computeFingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }

  /**
   * Check if a single env var is present in process.env.
   * Does not compute a fingerprint — lightweight presence check only.
   */
  isPresent(envVar: string): boolean {
    const rawValue = process.env[envVar];
    return typeof rawValue === 'string' && rawValue.length > 0;
  }

  /**
   * Check if ALL of the given env vars are present.
   * Returns false if any are missing.
   */
  areAllPresent(envVars: string[]): boolean {
    return envVars.every((v) => this.isPresent(v));
  }

  /**
   * Return the list of env vars that are NOT present in process.env.
   * Useful for generating blocker escalations.
   */
  getMissingEnvVars(envVars: string[]): string[] {
    return envVars.filter((v) => !this.isPresent(v));
  }

  /**
   * Record a verification result for a credential.
   *
   * This is called after a provider API check (e.g. Stripe balance query,
   * SendGrid API ping) to cache the outcome. Subsequent calls to
   * getCredentialMetadata will reflect this state without needing to
   * re-call the API.
   *
   * SECURITY: This method does not touch the credential value. It only
   * updates the metadata cache with the verification state and timestamp.
   *
   * @param envVar - The environment variable that was verified
   * @param state - The verification result (VALID, INVALID, EXPIRED, REVOKED)
   */
  recordVerification(envVar: string, state: CredentialState): void {
    const now = new Date().toISOString();
    const mapping = ENV_VAR_MAPPING[envVar] ?? { provider: 'unknown', capabilityId: 'unknown' };
    const rawValue = process.env[envVar];
    const present = typeof rawValue === 'string' && rawValue.length > 0;
    const fingerprint = present ? this.computeFingerprint(rawValue!) : null;

    const existing = this.metadataCache.get(envVar);

    // lastVerified is only updated when the state is VALID.
    // For INVALID/EXPIRED/REVOKED, we keep the previous lastVerified
    // if it exists, so we know when it was last known-good.
    const lastVerified =
      state === 'VALID'
        ? now
        : existing?.lastVerified ?? null;

    const metadata: CredentialMetadata = {
      envVar,
      present,
      state,
      fingerprint,
      lastVerified,
      lastChecked: now,
      provider: mapping.provider,
      capabilityId: mapping.capabilityId,
    };

    this.metadataCache.set(envVar, metadata);
  }

  /**
   * Get the current known credential state for an env var.
   *
   * If we have a cached verification result, return that state.
   * Otherwise, perform a fresh presence check and return ABSENT or PRESENT.
   */
  getCredentialState(envVar: string): CredentialState {
    const cached = this.metadataCache.get(envVar);
    if (cached) {
      // Verify the fingerprint hasn't changed since caching.
      const rawValue = process.env[envVar];
      const present = typeof rawValue === 'string' && rawValue.length > 0;
      const currentFingerprint = present ? this.computeFingerprint(rawValue!) : null;

      if (cached.fingerprint === currentFingerprint) {
        return cached.state;
      }
      // Fingerprint changed — credential was rotated. Return fresh state.
      return present ? 'PRESENT' : 'ABSENT';
    }

    // No cache — derive from presence.
    return this.isPresent(envVar) ? 'PRESENT' : 'ABSENT';
  }

  /**
   * Return a safe-to-log projection of credential metadata.
   *
   * This strips the fingerprint entirely (replaces with a boolean) so
   * that even hashed values are not emitted to logs. Use this for any
   * logging or console output.
   *
   * SECURITY: This object contains NO sensitive information. It is safe
   * to serialize and log.
   */
  redactForLogging(metadata: CredentialMetadata): RedactedCredentialMetadata {
    return {
      envVar: metadata.envVar,
      present: metadata.present,
      state: metadata.state,
      hasFingerprint: metadata.fingerprint !== null,
      lastVerified: metadata.lastVerified,
      lastChecked: metadata.lastChecked,
      provider: metadata.provider,
      capabilityId: metadata.capabilityId,
    };
  }

  /**
   * Return an audit-safe record of credential metadata.
   *
   * Unlike redactForLogging, this INCLUDES the fingerprint (hash only)
   * for correlation and audit trail purposes. The fingerprint is a
   * SHA-256 hash truncated to 16 hex chars — it cannot be reversed to
   * obtain the credential value.
   *
   * SECURITY: This record contains the fingerprint (hash) but NEVER the
   * credential value. It is safe to persist to an audit log or database.
   */
  toAuditRecord(metadata: CredentialMetadata): CredentialAuditRecord {
    return {
      envVar: metadata.envVar,
      present: metadata.present,
      state: metadata.state,
      fingerprint: metadata.fingerprint,
      lastVerified: metadata.lastVerified,
      lastChecked: metadata.lastChecked,
      provider: metadata.provider,
      capabilityId: metadata.capabilityId,
      recordedAt: new Date().toISOString(),
    };
  }

  /**
   * Clear the in-memory metadata cache.
   *
   * This does NOT affect process.env. It only clears cached verification
   * results, forcing fresh checks on the next getCredentialMetadata call.
   * Useful for testing or after a known credential rotation.
   */
  clearCache(): void {
    this.metadataCache.clear();
  }

  /**
   * Get all cached credential metadata entries.
   * Returns copies — callers cannot mutate the internal cache.
   */
  getAllCachedMetadata(): CredentialMetadata[] {
    return Array.from(this.metadataCache.values()).map((m) => ({ ...m }));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let secretManagerInstance: SecretManager | null = null;

/**
 * Get the singleton SecretManager instance.
 *
 * The singleton ensures a single in-memory verification cache across
 * the entire process, avoiding redundant API calls.
 */
export function getSecretManager(): SecretManager {
  if (!secretManagerInstance) {
    secretManagerInstance = new SecretManager();
  }
  return secretManagerInstance;
}

/**
 * Reset the singleton instance. Intended for testing only.
 * Clears the cache and drops the instance so the next getSecretManager()
 * call creates a fresh one.
 */
export function resetSecretManager(): void {
  if (secretManagerInstance) {
    secretManagerInstance.clearCache();
    secretManagerInstance = null;
  }
}
