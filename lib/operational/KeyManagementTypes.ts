/**
 * HYDI Key Management Types
 *
 * Normalized key/secret model for the Key Management Plane.
 *
 * SECURITY INVARIANT: These types NEVER contain plaintext secret material.
 * Only metadata, fingerprints (SHA-256 hashes), and opaque references are
 * stored, logged, or transmitted. The actual secret values live only in
 * the KeyVault abstraction and are never exposed through domain objects.
 *
 * This builds on the existing:
 *   - SecretManager (fingerprinting, presence, verification caching)
 *   - CredentialRunbookRegistry (runbooks, missing-detection)
 *   - ProviderAdapters (validate, verify, discover)
 *   - CapabilityAcquisitionTypes (CredentialState, CapabilityBlocker)
 *   - AutonomyPolicyModel (R0/R1/R2/R3/R5 authorization)
 *   - PolicyDecisionRecordStore (durable audit trail)
 */

import type { CredentialState, CapabilityBlocker, AuthorizationLevel } from './CapabilityAcquisitionTypes';
import type { CapabilityHealthState } from './CapabilityHealthManager';

// ─── Key Metadata Model ──────────────────────────────────────────────────

/**
 * The lifecycle state of a managed key.
 */
export type KeyLifecycleState =
  | 'DISCOVERED'       // found in environment but not yet managed
  | 'CLASSIFIED'       // metadata assigned, risk evaluated
  | 'ACTIVE'           // in use, validated
  | 'ROTATING'         // rotation in progress
  | 'ROTATED'          // rotation complete, old key disabled
  | 'EXPIRED'          // past expiration, needs rotation
  | 'REVOKED'          // intentionally revoked
  | 'COMPROMISED'      // suspected compromise, isolation in progress
  | 'ISOLATED'         // isolated from use, pending replacement
  | 'DEPRECATED'       // scheduled for destruction
  | 'DESTROYED'        // securely deleted
  | 'UNKNOWN';         // state not yet determined

/**
 * The type of credential.
 */
export type CredentialType =
  | 'api_key'
  | 'secret_key'
  | 'access_token'
  | 'refresh_token'
  | 'auth_token'
  | 'jwt'
  | 'private_key'
  | 'certificate'
  | 'connection_string'
  | 'password'
  | 'webhook_secret'
  | 'service_account'
  | 'unknown';

/**
 * The risk level of a key operation.
 */
export type KeyRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * The storage backend where the secret material resides.
 */
export type KeyStorageBackend =
  | 'env_file'          // .env.local or similar
  | 'env_var'           // process.env only
  | 'os_keychain'       // OS credential store (Windows Credential Manager, macOS Keychain)
  | 'local_vault'       // encrypted local vault file
  | 'docker_secret'     // Docker secret
  | 'supabase_vault'    // Supabase Vault
  | 'cloud_sm'          // cloud secret manager (AWS SM, GCP SM)
  | 'hsm'               // hardware security module
  | 'unknown';

/**
 * Normalized key metadata — the core domain object.
 *
 * IMPORTANT: This NEVER contains the secret value. Only:
 *   - fingerprint (SHA-256 hash, first 16 hex chars)
 *   - metadata (provider, type, environment, owner, scopes)
 *   - lifecycle state
 *   - timestamps
 *   - audit references
 */
export interface KeyMetadata {
  /** Unique key identifier (UUID) */
  id: string;
  /** Environment variable name (if bound to one) */
  envVar: string | null;
  /** Provider identifier (e.g., 'stripe', 'sendgrid') */
  provider: string;
  /** Credential type */
  credentialType: CredentialType;
  /** Service this credential is for (e.g., 'Stripe API', 'SendGrid API') */
  service: string;
  /** Environment (development, staging, production) */
  environment: string;
  /** Owner (who is responsible for this credential) */
  owner: string;
  /** Consumer (which service/component uses this credential) */
  consumer: string;
  /** Scopes/permissions (provider-specific, e.g., 'read_only', 'read_write') */
  scopes: string[];
  /** Creation timestamp (ISO) */
  createdAt: string;
  /** Last-used timestamp (ISO, or null if never used) */
  lastUsedAt: string | null;
  /** Expiration timestamp (ISO, or null if no expiration) */
  expiresAt: string | null;
  /** Rotation interval in days (or null if no scheduled rotation) */
  rotationIntervalDays: number | null;
  /** Rotation status */
  rotationStatus: KeyRotationStatus;
  /** Risk level */
  riskLevel: KeyRiskLevel;
  /** Lifecycle state */
  lifecycleState: KeyLifecycleState;
  /** Storage backend */
  storageBackend: KeyStorageBackend;
  /** Provisioning targets (which services consume this) */
  provisioningTargets: string[];
  /** Dependencies (which capabilities depend on this key) */
  dependencies: string[];
  /** Compromise status */
  compromiseStatus: CompromiseStatus;
  /** Last validation timestamp (ISO, or null) */
  lastValidationAt: string | null;
  /** Last validation result */
  lastValidationResult: CredentialState | null;
  /** Last rotation timestamp (ISO, or null) */
  lastRotatedAt: string | null;
  /** SHA-256 fingerprint (first 16 hex chars, never the value) */
  fingerprint: string | null;
  /** Audit reference (correlation ID for audit trail) */
  auditReference: string | null;
  /** Whether this key was discovered by the secret scanner */
  discoveredByScanner: boolean;
  /** Whether this key is in the allowlist (known test fixture) */
  allowlisted: boolean;
}

/**
 * Rotation status for a key.
 */
export type KeyRotationStatus =
  | 'NOT_DUE'           // rotation not scheduled
  | 'DUE'               // rotation interval elapsed
  | 'OVERDUE'           // rotation interval exceeded by >50%
  | 'IN_PROGRESS'       // rotation in progress
  | 'FAILED'            // last rotation attempt failed
  | 'NOT_CONFIGURED';   // no rotation interval set

/**
 * Compromise status for a key.
 */
export type CompromiseStatus =
  | 'CLEAN'             // no suspicion of compromise
  | 'SUSPECTED'         // possible compromise, under investigation
  | 'CONFIRMED'         // compromise confirmed
  | 'ISOLATED'          // isolated from use
  | 'REPLACED';         // compromised but replacement provisioned

// ─── Key Vault Interface ─────────────────────────────────────────────────

/**
 * Abstract KeyVault interface — stores secret material securely.
 *
 * Implementations:
 *   - LocalDevVault: encrypted file for development
 *   - OSKeychainVault: OS credential store
 *   - EnvVarVault: process.env (transient, not persisted)
 *
 * SECURITY: The vault stores actual secret values, but they are NEVER
 * returned through domain objects. Callers use store() and retrieve()
 * to manage values, and getMetadata() to get safe metadata.
 */
export interface KeyVault {
  /** Vault identifier */
  readonly vaultId: string;
  /** Vault type */
  readonly backend: KeyStorageBackend;
  /** Whether the vault is available (initialized, unlocked) */
  isAvailable(): boolean;

  /**
   * Store a secret value in the vault.
   * @param keyId - The key identifier to store under
   * @param value - The secret value (never logged, never returned through domain objects)
   * @param metadata - Additional metadata for the vault entry
   */
  store(keyId: string, value: string, metadata?: Record<string, string>): Promise<void>;

  /**
   * Retrieve a secret value from the vault.
   * Returns null if the key is not found.
   * SECURITY: The returned value must NOT be stored in domain objects,
   * logged, or transmitted. It should be used immediately for the
   * intended operation and then discarded.
   *
   * DEPRECATED: Use retrieveForAuthorizedOperation() instead, which
   * enforces authorization before returning the secret material.
   * This method is kept for backward compatibility but should not
   * be used in new code.
   */
  retrieve(keyId: string): Promise<string | null>;

  /**
   * Retrieve a secret value from the vault FOR an authorized operation.
   *
   * This is the preferred retrieval method. It enforces that:
   *   1. The caller has a valid authorization context
   *   2. The operation is permitted by policy
   *   3. The key exists and is in a state that allows retrieval
   *
   * Returns null if the key is not found or authorization is denied.
   * SECURITY: The returned CredentialMaterial must NOT be stored in
   * domain objects, logged, or transmitted. Use it immediately and
   * discard it.
   *
   * @param keyId - The key identifier to retrieve
   * @param operation - The operation that needs the credential (for audit)
   * @param authorizationToken - Authorization context (from PolicyEngine)
   */
  retrieveForAuthorizedOperation(
    keyId: string,
    operation: string,
    authorizationToken: AuthorizationToken,
  ): Promise<CredentialMaterial | null>;

  /**
   * Delete a secret from the vault.
   * Returns true if the key was found and deleted, false if not found.
   */
  delete(keyId: string): Promise<boolean>;

  /**
   * Check if a key exists in the vault.
   */
  exists(keyId: string): Promise<boolean>;

  /**
   * List all key IDs in the vault (metadata only, never values).
   */
  list(): Promise<string[]>;
}

// ─── Key Provider Interface ──────────────────────────────────────────────

/**
 * Provider interface for key lifecycle operations.
 *
 * This extends the existing ProviderAdapter interface with key-specific
 * operations (create, rotate, disable, revoke, destroy).
 *
 * Adapters for providers that don't support autonomous key creation
 * should throw UnsupportedOperationError for those methods.
 */
export interface KeyProvider {
  /** Provider identifier */
  readonly providerId: string;
  /** Human-readable provider name */
  readonly displayName: string;
  /** Whether this provider supports autonomous key creation */
  readonly supportsKeyCreation: boolean;
  /** Whether this provider supports key rotation */
  readonly supportsKeyRotation: boolean;
  /** Whether this provider supports key revocation */
  readonly supportsKeyRevocation: boolean;

  /**
   * Discover existing keys for this provider.
   * Returns metadata only, never values.
   */
  discover(): Promise<KeyMetadata[]>;

  /**
   * Create a new key/credential.
   * @param options - Key creation options (type, scopes, description)
   * @returns The created key value (to be stored in vault) and metadata
   */
  create(options: KeyCreationOptions): Promise<KeyCreationResult>;

  /**
   * Validate that a key is valid by calling the provider API.
   */
  validate(keyId: string, keyValue: string): Promise<CredentialState>;

  /**
   * Provision a key to a consumer (e.g., write to .env.local).
   */
  provision(keyId: string, keyValue: string, target: ProvisioningTarget): Promise<ProvisioningResult>;

  /**
   * Rotate a key — create a new key and disable the old one.
   * The old key is NOT destroyed until the new key is verified.
   */
  rotate(keyId: string, oldKeyValue: string): Promise<RotationResult>;

  /**
   * Disable a key (prevent further use without destroying it).
   */
  disable(keyId: string, keyValue: string): Promise<boolean>;

  /**
   * Revoke a key (permanently invalidate).
   */
  revoke(keyId: string, keyValue: string): Promise<boolean>;

  /**
   * Destroy a key (permanently delete from provider).
   */
  destroy(keyId: string, keyValue: string): Promise<boolean>;

  /**
   * Get usage metadata for a key (last used, usage count, etc.).
   */
  usage(keyId: string, keyValue: string): Promise<KeyUsageMetadata>;
}

/**
 * Options for creating a new key.
 */
export interface KeyCreationOptions {
  /** Credential type */
  credentialType: CredentialType;
  /** Requested scopes/permissions */
  scopes: string[];
  /** Human-readable description */
  description: string;
  /** Whether this is a dry-run (don't actually create) */
  dryRun: boolean;
}

/**
 * Result of key creation.
 */
export interface KeyCreationResult {
  /** The new key value (to be stored in vault, never logged) */
  keyValue: string;
  /** Metadata about the created key */
  metadata: Partial<KeyMetadata>;
  /** Provider-specific response */
  providerResponse: Record<string, unknown>;
}

/**
 * Target for key provisioning.
 */
export interface ProvisioningTarget {
  /** Target type */
  type: 'env_file' | 'env_var' | 'config_file' | 'docker_secret';
  /** Target path (for file-based targets) */
  path?: string;
  /** Environment variable name */
  envVar?: string;
}

/**
 * Result of key provisioning.
 */
export interface ProvisioningResult {
  success: boolean;
  target: ProvisioningTarget;
  evidence: string;
}

/**
 * Result of key rotation.
 */
export interface RotationResult {
  /** The new key value */
  newKeyValue: string;
  /** Metadata about the new key */
  newMetadata: Partial<KeyMetadata>;
  /** Whether the old key was disabled */
  oldKeyDisabled: boolean;
  /** Provider response */
  providerResponse: Record<string, unknown>;
}

/**
 * Usage metadata for a key.
 */
export interface KeyUsageMetadata {
  lastUsedAt: string | null;
  usageCount: number | null;
  /** Provider-specific usage data */
  details: Record<string, unknown>;
}

// ─── Key Audit ───────────────────────────────────────────────────────────

/**
 * Key lifecycle operation types for audit.
 */
export type KeyAuditOperation =
  | 'DISCOVER'
  | 'CLASSIFY'
  | 'GENERATE'
  | 'STORE'
  | 'PROVISION'
  | 'VALIDATE'
  | 'ROTATE'
  | 'REVOKE'
  | 'RECOVER'
  | 'DESTROY'
  | 'COMPROMISE_RESPONSE'
  | 'SCAN'
  | 'RECONCILE'
  | 'HEALTH_CHECK';

/**
 * An immutable audit record for a key lifecycle operation.
 * NEVER contains secret material.
 */
export interface KeyAuditRecord {
  /** Unique audit record ID */
  auditId: string;
  /** Correlation ID (links related operations) */
  correlationId: string;
  /** Operation type */
  operation: KeyAuditOperation;
  /** Actor (who/what initiated the operation) */
  actor: string;
  /** Decision (ALLOW_AUTONOMOUS, REQUIRES_OWNER_AUTHORIZATION, DENY, etc.) */
  decision: string;
  /** Policy that was applied */
  policy: string | null;
  /** Authorization result */
  authorizationResult: string;
  /** Target key ID */
  keyId: string;
  /** Provider */
  provider: string;
  /** Key identifier (env var name or vault key) */
  keyIdentifier: string;
  /** Previous lifecycle state */
  previousState: KeyLifecycleState;
  /** Resulting lifecycle state */
  resultingState: KeyLifecycleState;
  /** Validation result */
  validationResult: CredentialState | null;
  /** Failure reason (if any) */
  failureReason: string | null;
  /** Risk level */
  riskLevel: KeyRiskLevel;
  /** Timestamp */
  timestamp: string;
  /** Duration in ms */
  durationMs: number;
  /** Credential fingerprint (hash, never the value) */
  fingerprint: string | null;
  /** Additional detail (never secrets) */
  detail: Record<string, unknown>;
}

// ─── Key Health ──────────────────────────────────────────────────────────

/**
 * Health status for a managed key.
 */
export interface KeyHealthStatus {
  keyId: string;
  /** Overall health */
  healthy: boolean;
  /** Specific health findings */
  findings: KeyHealthFinding[];
  /** Last checked */
  checkedAt: string;
}

/**
 * A specific health finding for a key.
 */
export interface KeyHealthFinding {
  /** Finding type */
  type: KeyHealthFindingType;
  /** Severity */
  severity: 'info' | 'warning' | 'critical';
  /** Description */
  description: string;
  /** Recommended action */
  recommendedAction: string;
}

/**
 * Types of key health findings.
 */
export type KeyHealthFindingType =
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'ROTATION_OVERDUE'
  | 'ROTATION_DUE'
  | 'UNUSED'
  | 'ORPHANED'
  | 'EXCESSIVE_PERMISSIONS'
  | 'AUTH_FAILURE'
  | 'ROTATION_FAILURE'
  | 'PROVISIONING_DRIFT'
  | 'DISABLED_BUT_REFERENCED'
  | 'MISSING_FROM_INVENTORY'
  | 'LEAKED_IN_REPOSITORY'
  | 'SUSPICIOUS_USAGE';

// ─── Key Inventory ───────────────────────────────────────────────────────

/**
 * The key inventory — a collection of all managed keys.
 */
export interface KeyInventory {
  /** All managed keys */
  keys: KeyMetadata[];
  /** Summary statistics */
  summary: KeyInventorySummary;
  /** When the inventory was last reconciled */
  lastReconciledAt: string;
}

/**
 * Summary statistics for the key inventory.
 */
export interface KeyInventorySummary {
  total: number;
  active: number;
  expiring: number;
  expired: number;
  rotationDue: number;
  rotationOverdue: number;
  compromised: number;
  revoked: number;
  destroyed: number;
  byRiskLevel: Record<KeyRiskLevel, number>;
  byProvider: Record<string, number>;
  byStorageBackend: Record<KeyStorageBackend, number>;
}

// ─── Opaque Credential Reference ──────────────────────────────────────────

/**
 * Opaque reference to a credential — used in decision objects, audit records,
 * telemetry, dashboard responses, and LLM/HEIDI context.
 *
 * This is the ONLY type that should appear in:
 *   - audit records
 *   - API responses
 *   - dashboard payloads
 *   - error messages
 *   - HEIDI decision context
 *   - LLM prompts
 *
 * It NEVER contains the secret value. It is a stable, opaque identifier
 * that can be resolved to the actual material ONLY through the
 * CredentialVault.retrieveForAuthorizedOperation() method.
 *
 * Example: "cred_01J..."
 */
export type CredentialRef = string;

/**
 * Authorization token for vault retrieval.
 *
 * This is issued by the KeyPolicyEngine when an operation is authorized.
 * It proves that the caller has gone through the governance pipeline
 * and is permitted to access the credential material.
 *
 * The token is opaque — it does not contain the secret value.
 * It is validated by the vault before returning the material.
 */
export interface AuthorizationToken {
  /** The operation that was authorized */
  operation: string;
  /** The policy decision that authorized this operation */
  decision: string;
  /** The policy ID that matched */
  policyId: string;
  /** The authorization level required */
  requiredAuthorization: string;
  /** When the token was issued */
  issuedAt: string;
  /** The key ID that this token authorizes access to (or 'any' for discovery) */
  keyId: string;
  /** Whether this is a dry-run (no actual side effects) */
  dryRun: boolean;
}

/**
 * Branded type for actual credential material (the secret value).
 *
 * This type exists to make it explicit in the type system when a function
 * handles actual secret material. It should NEVER appear in:
 *   - domain objects (use CredentialRef)
 *   - audit records (use CredentialRef)
 *   - API responses (use CredentialRef)
 *   - logs (never)
 *   - LLM context (never)
 *
 * It should ONLY appear as a parameter to:
 *   - KeyVault.store()
 *   - KeyVault.retrieveForAuthorizedOperation() return value
 *   - KeyProvider.create() return value
 *   - KeyProvider.validate() parameter
 *   - KeyProvider.provision() parameter
 *   - KeyProvider.rotate() return value
 *   - KeyProvider.revoke() parameter
 *   - KeyProvider.destroy() parameter
 */
export type CredentialMaterial = string & { readonly __brand: 'CredentialMaterial' };

/**
 * Brand a plaintext string as CredentialMaterial.
 * This is a type-level marker — it does NOT encrypt or protect the value.
 * It simply makes it explicit in the type system that this string contains
 * actual secret material.
 */
export function brandCredentialMaterial(value: string): CredentialMaterial {
  return value as CredentialMaterial;
}

/**
 * Check if a value looks like a CredentialRef (opaque ID).
 * CredentialRefs are UUIDs or prefixed identifiers like "cred_...".
 */
export function isCredentialRef(value: unknown): value is CredentialRef {
  if (typeof value !== 'string') return false;
  // UUID format or cred_ prefix
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    || value.startsWith('cred_');
}

// ─── Credential Health State (distinct from service health) ───────────────

/**
 * The health state of a credential itself — distinct from the health of
 * the service that consumes it.
 *
 * A credential can be VALID (credential is healthy) while the service is
 * DEGRADED (service has issues unrelated to the credential).
 * Conversely, a credential can be EXPIRED while the service is still
 * READY (using a cached token or fallback).
 *
 * This distinction is essential for correct diagnosis.
 */
export type CredentialHealthState =
  | 'VALID'           // credential is valid and not expiring soon
  | 'EXPIRING_SOON'   // credential is valid but expires within 30 days
  | 'EXPIRED'         // credential has passed its expiration date
  | 'REVOKED'         // credential has been revoked by the provider
  | 'COMPROMISED'     // credential is suspected or confirmed compromised
  | 'ROTATION_REQUIRED' // credential is valid but rotation is overdue
  | 'UNKNOWN'         // credential has not been validated
  | 'BLOCKED';        // credential is missing entirely

/**
 * Combined health report that distinguishes credential health from service health.
 */
export interface CredentialServiceHealthReport {
  /** The credential health state (is the key valid?) */
  credentialState: CredentialHealthState;
  /** The service health state (is the dependent service working?) */
  serviceState: CapabilityHealthState;
  /** Evidence for the credential state */
  credentialEvidence: string;
  /** Evidence for the service state */
  serviceEvidence: string;
  /** Whether the service failure is caused by the credential */
  credentialIsRootCause: boolean;
  /** When the credential was last validated */
  lastCredentialValidation: string | null;
  /** When the service was last checked */
  lastServiceCheck: string | null;
}

// ─── Provisioning Capability Result ───────────────────────────────────────

/**
 * Result of checking whether a credential can be autonomously provisioned.
 */
export type ProvisioningCapability =
  | 'AUTOMATED'              // provider supports full autonomous creation
  | 'SUPPORTED'              // provider supports creation but needs authorization
  | 'REQUIRES_AUTHORIZATION' // provider supports creation but needs owner authorization
  | 'REQUIRES_HUMAN_ACTION'  // provider does not support API-based creation
  | 'UNSUPPORTED'            // provider does not support this operation at all
  | 'FAILED'                 // attempt was made and failed
  | 'UNKNOWN';               // capability not yet determined

/**
 * Result of a provisioning capability check.
 */
export interface ProvisioningCapabilityResult {
  capability: ProvisioningCapability;
  /** What the provider supports */
  providerSupports: boolean;
  /** What policy allows */
  policyAllows: boolean;
  /** The exact human/provider action required if automation is not possible */
  requiredHumanAction: string | null;
  /** The authorization level required */
  requiredAuthorization: string;
  /** Evidence/explanation */
  evidence: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────

/**
 * Error thrown when a provider doesn't support an operation.
 */
export class UnsupportedOperationError extends Error {
  constructor(provider: string, operation: string) {
    super(`Provider '${provider}' does not support operation '${operation}'`);
    this.name = 'UnsupportedOperationError';
  }
}

/**
 * Error thrown when a key is not found.
 */
export class KeyNotFoundError extends Error {
  constructor(keyId: string) {
    super(`Key not found: ${keyId}`);
    this.name = 'KeyNotFoundError';
  }
}

/**
 * Error thrown when a key operation is denied by policy.
 */
export class KeyPolicyDeniedError extends Error {
  constructor(keyId: string, operation: string, reason: string) {
    super(`Policy denied ${operation} for key ${keyId}: ${reason}`);
    this.name = 'KeyPolicyDeniedError';
  }
}
