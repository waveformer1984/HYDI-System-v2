/**
 * Capability Acquisition Types
 *
 * Core type definitions for the External Capability Acquisition Engine.
 * These are the declarative structures that govern how HEIDI acquires,
 * provisions, and verifies external capabilities.
 */

// ─── Credential Intelligence (Phase 5) ────────────────────────────────────

/**
 * Structured blocker reasons. Replaces the single "BLOCKED" state with
 * a precise classification of WHY the capability is unavailable.
 *
 * This is critical for autonomous reasoning — HEIDI needs to know not
 * just THAT something is blocked, but WHAT KIND of block it is, because
 * different blocks require different resolution strategies.
 */
export type CapabilityBlocker =
  | 'MISSING_CREDENTIAL'           // env var not set
  | 'INVALID_CREDENTIAL'           // env var set but API rejects it
  | 'EXPIRED_CREDENTIAL'           // credential was valid but has expired
  | 'REVOKED_CREDENTIAL'           // credential was revoked by provider
  | 'CREDENTIAL_PRESENT_UNVERIFIED' // env var set but not yet verified
  | 'ACCOUNT_MISSING'              // no account exists with the provider
  | 'ACCOUNT_RESTRICTED'           // account exists but is restricted/suspended
  | 'BILLING_REQUIRED'             // account exists but billing not set up
  | 'LEGAL_AUTHORIZATION_REQUIRED' // terms of service not accepted
  | 'IDENTITY_VERIFICATION_REQUIRED' // phone/identity verification needed
  | 'PROVIDER_UNAVAILABLE'         // provider API is down
  | 'RATE_LIMITED'                 // provider is rate-limiting us
  | 'POLICY_NOT_AUTHORIZED'        // HEIDI policy denies this action
  | 'CONFIGURATION_ERROR'          // local configuration is wrong
  | 'DEPENDENCY_NOT_READY'         // a prerequisite capability isn't ready
  | 'UNKNOWN';                     // unclassified

/**
 * Credential state — finer-grained than READY/BLOCKED.
 */
export type CredentialState =
  | 'ABSENT'          // not in environment
  | 'PRESENT'         // in environment but unverified
  | 'VALID'           // verified against provider API
  | 'INVALID'         // provider API rejected it
  | 'EXPIRED'         // provider API says expired
  | 'REVOKED'         // provider API says revoked
  | 'UNKNOWN';        // can't determine

// ─── Governance (Phase 11) ────────────────────────────────────────────────

/**
 * Authorization levels — extends the existing R0/R1/R2/R5 model with
 * finer-grained distinctions for external commitments.
 *
 * These map to the existing HEIDI governance model:
 *   R0 = observation (autonomous)
 *   R1 = reversible local action (autonomous)
 *   R2 = external side effect (requires authorization)
 *   R3 = financial/legal/identity commitment (requires owner authorization)
 *   R5 = never authorized (guardian block)
 */
export type AuthorizationLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R5';

/**
 * Policy decision for a proposed action.
 */
export type PolicyDecision =
  | 'ALLOW_AUTONOMOUS'           // HEIDI can do this without asking
  | 'ALLOW_WITH_POLICY'          // HEIDI can do this if policy constraints are met
  | 'REQUIRES_OWNER_AUTHORIZATION' // HEIDI must ask the human first
  | 'DENY';                      // HEIDI must not do this

/**
 * The type of external commitment an action requires.
 * Used to classify what kind of human authorization is needed.
 */
export type ExternalCommitmentType =
  | 'FINANCIAL'           // involves money, card on file, subscription
  | 'LEGAL'               // involves accepting terms of service
  | 'IDENTITY'            // involves identity/phone verification
  | 'ACCOUNT_CREATION'    // involves creating a new account
  | 'RESOURCE_CREATION'   // involves creating a resource (API key, webhook)
  | 'CREDENTIAL_PROVISIONING' // involves storing a credential
  | 'CONFIGURATION_CHANGE'    // involves changing local config
  | 'SERVICE_RESTART'     // involves restarting a local service
  | 'NONE';               // no external commitment

/**
 * A typed external commitment — represents what HEIDI would need to do
 * if it were to execute a particular acquisition step.
 */
export interface ExternalCommitment {
  type: ExternalCommitmentType;
  provider: string;
  description: string;
  estimatedCost?: number;
  currency?: string;
  requiresAuthorization: boolean;
  authorizationLevel: AuthorizationLevel;
  reversible: boolean;
}

// ─── Acquisition Plan (Phase 3) ───────────────────────────────────────────

/**
 * A single step in an acquisition workflow.
 */
export interface AcquisitionStep {
  /** Unique step ID */
  id: string;
  /** Human-readable description */
  description: string;
  /** The type of commitment this step requires */
  commitmentType: ExternalCommitmentType;
  /** Authorization level required */
  authorizationLevel: AuthorizationLevel;
  /** Whether this step can be executed autonomously by HEIDI */
  autonomous: boolean;
  /** Whether this step is reversible */
  reversible: boolean;
  /** The action to execute (adapter method name or inline function) */
  action: string;
  /** Expected result */
  expectedOutcome: string;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Retry policy for this step */
  retryPolicy?: RetryPolicy;
}

/**
 * A verification step — proves the capability actually works.
 */
export interface VerificationStep {
  id: string;
  description: string;
  /** The provider API operation to call (must be safe, low-risk) */
  operation: string;
  /** What constitutes a pass */
  passCriteria: string;
  timeoutMs: number;
  /** Credentials needed for verification */
  requiredCredentials: string[];
}

/**
 * A prerequisite that must be met before acquisition can start.
 */
export interface Prerequisite {
  description: string;
  /** How to check if the prerequisite is met */
  checkType: 'env_var' | 'capability_ready' | 'network_reachable' | 'account_exists';
  /** The env var / capability / host to check */
  target: string;
}

/**
 * A secret requirement — describes what credential is needed.
 */
export interface SecretRequirement {
  /** Environment variable name */
  envVar: string;
  /** What this credential is for */
  purpose: string;
  /** Whether HEIDI can provision this itself or needs human input */
  provisioningMode: 'autonomous' | 'human_provided' | 'hybrid';
  /** How to verify the credential is valid */
  verificationMethod: string;
  /** Whether this is a secret that must never be logged */
  sensitive: boolean;
}

/**
 * Rollback plan for failed acquisitions.
 */
export interface RollbackPlan {
  steps: {
    description: string;
    action: string;
    reversible: boolean;
  }[];
}

/**
 * The complete declarative acquisition plan for a capability.
 */
export interface CapabilityAcquisitionPlan {
  capabilityId: string;
  provider: string;
  displayName: string;

  prerequisites: Prerequisite[];
  discovery: AcquisitionStep[];
  acquisition: AcquisitionStep[];
  provisioning: AcquisitionStep[];
  verification: VerificationStep[];

  requiredAuthorization: AuthorizationLevel;
  reversible: boolean;
  financialCommitment: boolean;
  legalAcceptance: boolean;
  identityVerification: boolean;

  secretRequirements: SecretRequirement[];
  rollback?: RollbackPlan;

  /** Which env file should contain the credentials */
  envFile: string;
  /** Which services consume this capability */
  consumingServices: string[];
  /** Whether the daemon needs restart after provisioning */
  requiresDaemonRestart: boolean;
}

// ─── Capability State Machine (Phase 18) ──────────────────────────────────

/**
 * The lifecycle state of a capability being acquired.
 */
export type CapabilityAcquisitionState =
  | 'UNKNOWN'
  | 'DISCOVERING'
  | 'BLOCKED'
  | 'PLANNED'
  | 'AUTHORIZING'
  | 'ACQUIRING'
  | 'PROVISIONING'
  | 'CONFIGURING'
  | 'VERIFYING'
  | 'QUALIFYING'
  | 'READY'
  | 'ACQUISITION_FAILED'
  | 'PROVISIONING_FAILED'
  | 'VERIFICATION_FAILED'
  | 'POLICY_BLOCKED'
  | 'PROVIDER_UNAVAILABLE';

/**
 * A state transition record.
 */
export interface StateTransition {
  from: CapabilityAcquisitionState;
  to: CapabilityAcquisitionState;
  timestamp: string;
  reason: string;
  evidence: string;
}

// ─── Retry Policy (Phase 10) ──────────────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  /** Failure types that should NOT be retried */
  nonRetryableFailures: FailureClass[];
}

/**
 * Classification of failures for retry decisions.
 */
export type FailureClass =
  | 'TEMPORARY_FAILURE'     // transient network issue, retry
  | 'PERMANENT_FAILURE'     // won't succeed on retry
  | 'AUTHORIZATION_FAILURE' // policy denied, don't retry
  | 'CREDENTIAL_FAILURE'    // bad credentials, don't retry
  | 'PROVIDER_OUTAGE'       // provider is down, retry with backoff
  | 'RATE_LIMITED'          // rate limited, retry with longer backoff
  | 'CONFIGURATION_FAILURE' // local config wrong, don't retry
  | 'UNKNOWN_FAILURE';      // can't classify, retry once

// ─── Audit Trail (Phase 16) ───────────────────────────────────────────────

/**
 * Audit event types for the acquisition lifecycle.
 */
export type AcquisitionAuditEventType =
  | 'CAPABILITY_DISCOVERED'
  | 'BLOCKER_IDENTIFIED'
  | 'ACQUISITION_PLANNED'
  | 'POLICY_EVALUATED'
  | 'AUTHORIZATION_GRANTED'
  | 'AUTHORIZATION_DENIED'
  | 'ACQUISITION_STARTED'
  | 'RESOURCE_CREATED'
  | 'CREDENTIAL_PROVISIONED'
  | 'CONFIGURATION_APPLIED'
  | 'SERVICE_RESTARTED'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_PASSED'
  | 'VERIFICATION_FAILED'
  | 'CAPABILITY_QUALIFIED'
  | 'CAPABILITY_READY'
  | 'ACQUISITION_FAILED'
  | 'PROVISIONING_FAILED'
  | 'RECOVERY_STARTED'
  | 'RECOVERY_SUCCEEDED'
  | 'RECOVERY_FAILED'
  | 'ROLLBACK_STARTED'
  | 'ROLLBACK_COMPLETED'
  | 'RETRY_SCHEDULED'
  | 'CIRCUIT_BREAKER_TRIPPED';

/**
 * An audit record for a single acquisition event.
 * Never contains secret values.
 */
export interface AcquisitionAuditRecord {
  timestamp: string;
  eventType: AcquisitionAuditEventType;
  capabilityId: string;
  provider: string;
  /** The acquisition lifecycle ID this event belongs to */
  lifecycleId: string;
  /** Human-readable description */
  description: string;
  /** Policy decision if this was a governance event */
  policyDecision?: PolicyDecision;
  /** Authorization level if relevant */
  authorizationLevel?: AuthorizationLevel;
  /** Failure class if this was a failure event */
  failureClass?: FailureClass;
  /** Credential fingerprint (hash, never the value) */
  credentialFingerprint?: string;
  /** Latency in ms if this was a verification */
  latencyMs?: number;
  /** Error message (sanitized, no secrets) */
  error?: string;
  /** State transition if applicable */
  stateTransition?: StateTransition;
}

// ─── Owner Authorization (Phase 14) ───────────────────────────────────────

/**
 * An owner authorization scope. The owner can authorize classes of
 * actions rather than approving every individual step.
 */
export interface OwnerAuthorization {
  id: string;
  /** Which provider/capability this authorizes */
  provider: string;
  capabilityId: string;
  /** What types of commitments are authorized */
  authorizedCommitments: ExternalCommitmentType[];
  /** Maximum financial commitment authorized (in cents) */
  maxFinancialCommitmentCents?: number;
  /** Currency for the financial limit */
  currency?: string;
  /** When this authorization was granted */
  grantedAt: string;
  /** When this authorization expires (null = never) */
  expiresAt: string | null;
  /** Whether this authorization has been revoked */
  revokedAt: string | null;
  /** Who granted this authorization */
  grantedBy: string;
  /** Additional constraints */
  constraints?: {
    allowedRegions?: string[];
    allowedResources?: string[];
    rateLimitPerHour?: number;
  };
}

// ─── Safety Limits (Phase 15) ─────────────────────────────────────────────

/**
 * Safety limits for the acquisition engine.
 */
export interface AcquisitionSafetyLimits {
  maxFinancialCommitmentCents: number;
  maxRetryCount: number;
  maxExecutionDurationMs: number;
  maxConcurrentAcquisitions: number;
  maxCredentialRotationsPerHour: number;
  maxAccountCreationsPerDay: number;
  providerRateLimits: Record<string, { requestsPerMinute: number }>;
  killSwitchActive: boolean;
  autonomousModeEnabled: boolean;
}

export const DEFAULT_SAFETY_LIMITS: AcquisitionSafetyLimits = {
  maxFinancialCommitmentCents: 0, // no financial commitments by default
  maxRetryCount: 3,
  maxExecutionDurationMs: 300000, // 5 minutes
  maxConcurrentAcquisitions: 1,
  maxCredentialRotationsPerHour: 5,
  maxAccountCreationsPerDay: 0, // no account creation by default
  providerRateLimits: {
    stripe: { requestsPerMinute: 20 },
    sendgrid: { requestsPerMinute: 10 },
    google_places: { requestsPerMinute: 5 },
    twilio: { requestsPerMinute: 10 },
  },
  killSwitchActive: false,
  autonomousModeEnabled: true,
};

// ─── Acquisition Lifecycle ────────────────────────────────────────────────

/**
 * The complete lifecycle record for a single acquisition attempt.
 * Persisted to the database so state survives daemon restarts.
 */
export interface AcquisitionLifecycle {
  id: string;
  capabilityId: string;
  provider: string;
  currentState: CapabilityAcquisitionState;
  blocker: CapabilityBlocker | null;
  plan: CapabilityAcquisitionPlan | null;
  policyDecision: PolicyDecision | null;
  startedAt: string;
  completedAt: string | null;
  transitions: StateTransition[];
  auditRecords: AcquisitionAuditRecord[];
  retryCount: number;
  lastError: string | null;
  /** Credential fingerprints (hashes, never values) */
  credentialFingerprints: Record<string, string>;
}
