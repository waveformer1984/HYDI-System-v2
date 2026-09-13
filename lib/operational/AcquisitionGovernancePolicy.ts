/**
 * Acquisition Governance Policy
 *
 * Governance policy for the External Capability Acquisition Engine.
 * Extends HEIDI's existing R0/R1/R2/R5 autonomy model with finer-grained
 * distinctions for external commitments.
 *
 * The existing AutonomyPolicyModel governs internal capability execution
 * (health.recover, runtime.probe, etc.) against observed component state.
 * This policy governs external commitments — actions that create side
 * effects outside HEIDI's own infrastructure: financial charges, legal
 * acceptances, identity verifications, account/resource creation, and
 * credential provisioning.
 *
 * Principle: identity decides permission, not reality.
 * Principle: confidence ≠ authorization.
 * Principle: external commitments require explicit owner authorization
 *            unless they are reversible local actions.
 */

import type {
  AuthorizationLevel,
  PolicyDecision,
  ExternalCommitmentType,
  OwnerAuthorization,
} from './CapabilityAcquisitionTypes';

/**
 * Internal policy rule mapping for each commitment type.
 */
interface CommitmentPolicyRule {
  commitmentType: ExternalCommitmentType;
  authorizationLevel: AuthorizationLevel;
  defaultDecision: PolicyDecision;
  requiresOwnerAuthorization: boolean;
}

/**
 * Default policy mapping for external commitment types.
 *
 * Maps each ExternalCommitmentType to an AuthorizationLevel and a
 * default PolicyDecision. This extends the existing R0/R1/R2/R5 model:
 *   R0 = observation (autonomous)
 *   R1 = reversible local action (autonomous)
 *   R2 = external side effect (requires authorization)
 *   R3 = financial/legal/identity commitment (requires owner authorization)
 *   R5 = never authorized (guardian block)
 */
const DEFAULT_COMMITMENT_POLICIES: CommitmentPolicyRule[] = [
  {
    commitmentType: 'NONE',
    authorizationLevel: 'R0',
    defaultDecision: 'ALLOW_AUTONOMOUS',
    requiresOwnerAuthorization: false,
  },
  {
    commitmentType: 'CONFIGURATION_CHANGE',
    authorizationLevel: 'R1',
    defaultDecision: 'ALLOW_AUTONOMOUS',
    requiresOwnerAuthorization: false,
  },
  {
    commitmentType: 'SERVICE_RESTART',
    authorizationLevel: 'R1',
    defaultDecision: 'ALLOW_AUTONOMOUS',
    requiresOwnerAuthorization: false,
  },
  {
    commitmentType: 'CREDENTIAL_PROVISIONING',
    authorizationLevel: 'R1',
    defaultDecision: 'ALLOW_AUTONOMOUS',
    requiresOwnerAuthorization: false,
  },
  {
    commitmentType: 'RESOURCE_CREATION',
    authorizationLevel: 'R2',
    defaultDecision: 'REQUIRES_OWNER_AUTHORIZATION',
    requiresOwnerAuthorization: true,
  },
  {
    commitmentType: 'ACCOUNT_CREATION',
    authorizationLevel: 'R3',
    defaultDecision: 'REQUIRES_OWNER_AUTHORIZATION',
    requiresOwnerAuthorization: true,
  },
  {
    commitmentType: 'FINANCIAL',
    authorizationLevel: 'R3',
    defaultDecision: 'REQUIRES_OWNER_AUTHORIZATION',
    requiresOwnerAuthorization: true,
  },
  {
    commitmentType: 'LEGAL',
    authorizationLevel: 'R3',
    defaultDecision: 'REQUIRES_OWNER_AUTHORIZATION',
    requiresOwnerAuthorization: true,
  },
  {
    commitmentType: 'IDENTITY',
    authorizationLevel: 'R3',
    defaultDecision: 'REQUIRES_OWNER_AUTHORIZATION',
    requiresOwnerAuthorization: true,
  },
];

/**
 * The set of commitment types that are always allowed autonomously.
 * These are reversible local actions with no external side effects.
 */
const AUTONOMOUS_COMMITMENT_TYPES: ReadonlySet<ExternalCommitmentType> =
  new Set<ExternalCommitmentType>([
    'NONE',
    'CONFIGURATION_CHANGE',
    'SERVICE_RESTART',
    'CREDENTIAL_PROVISIONING',
  ]);

/**
 * The shape of an action passed to evaluate().
 */
interface GovernanceAction {
  commitmentType: ExternalCommitmentType;
  authorizationLevel: AuthorizationLevel;
  provider: string;
}

/**
 * Acquisition Governance Policy
 *
 * Evaluates proposed external capability acquisition actions against
 * HEIDI's governance model. Determines whether an action may proceed
 * autonomously, requires owner authorization, or must be denied.
 *
 * This class is deterministic — given the same action and owner
 * authorizations, it always returns the same decision. The LLM may
 * propose acquisition steps, but this policy engine decides what is
 * actually permitted.
 */
export class AcquisitionGovernancePolicy {
  private readonly policyRules: Map<ExternalCommitmentType, CommitmentPolicyRule>;
  private killSwitchActive: boolean = false;

  constructor() {
    this.policyRules = new Map(
      DEFAULT_COMMITMENT_POLICIES.map((rule) => [rule.commitmentType, rule]),
    );
  }

  /**
   * Set the kill switch state. When active, all actions are denied
   * except NONE (pure observation with no commitment).
   */
  setKillSwitch(active: boolean): void {
    this.killSwitchActive = active;
  }

  /**
   * Check if the kill switch is currently active.
   */
  isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }

  /**
   * Evaluate a proposed action against the governance policy.
   *
   * Decision logic:
   *   1. If kill switch is active → DENY everything except NONE
   *   2. If commitment type is autonomous (NONE/CONFIGURATION_CHANGE/
   *      SERVICE_RESTART/CREDENTIAL_PROVISIONING) → ALLOW_AUTONOMOUS
   *   3. If commitment type requires owner authorization:
   *      a. Check if a valid (not expired, not revoked) owner authorization
   *         exists for this provider and commitment type
   *      b. If financial commitment → check maxFinancialCommitmentCents
   *      c. If valid authorization exists → ALLOW_AUTONOMOUS
   *      d. If no matching authorization → REQUIRES_OWNER_AUTHORIZATION
   *
   * @param action - The proposed action to evaluate
   * @param ownerAuthorizations - Active owner authorizations to check against
   * @returns The policy decision
   */
  evaluate(
    action: GovernanceAction,
    ownerAuthorizations: OwnerAuthorization[],
  ): PolicyDecision {
    // 1. Kill switch: deny everything except NONE
    if (this.killSwitchActive && action.commitmentType !== 'NONE') {
      return 'DENY';
    }

    // 2. Autonomous commitment types — always allowed
    if (AUTONOMOUS_COMMITMENT_TYPES.has(action.commitmentType)) {
      return 'ALLOW_AUTONOMOUS';
    }

    // 3. Commitment types requiring owner authorization
    const rule = this.policyRules.get(action.commitmentType);
    if (!rule) {
      // Unknown commitment type — fail closed
      return 'DENY';
    }

    if (!rule.requiresOwnerAuthorization) {
      return rule.defaultDecision;
    }

    // Check if a valid owner authorization exists for this provider + commitment type
    const hasAuth = this.checkOwnerAuthorization(
      action.provider,
      action.commitmentType,
      ownerAuthorizations,
    );

    if (!hasAuth) {
      return 'REQUIRES_OWNER_AUTHORIZATION';
    }

    // For financial commitments, verify the financial limit is sufficient
    if (action.commitmentType === 'FINANCIAL') {
      // checkOwnerAuthorization already validated the authorization exists,
      // but financial commitments have an additional constraint: the
      // authorization must specify a maxFinancialCommitmentCents > 0.
      // The caller is responsible for checking the specific amount via
      // checkFinancialLimit() before executing. At the policy level,
      // a valid authorization with a financial limit means the action
      // can proceed under that authorization.
      const hasFinancialLimit = ownerAuthorizations.some(
        (auth) =>
          this.isAuthorizationValid(auth) &&
          auth.provider === action.provider &&
          auth.authorizedCommitments.includes('FINANCIAL') &&
          typeof auth.maxFinancialCommitmentCents === 'number' &&
          auth.maxFinancialCommitmentCents > 0,
      );

      if (!hasFinancialLimit) {
        return 'REQUIRES_OWNER_AUTHORIZATION';
      }
    }

    // Valid owner authorization exists for this provider + commitment type
    return 'ALLOW_AUTONOMOUS';
  }

  /**
   * Check if the owner has granted a valid authorization for a specific
   * provider and commitment type.
   *
   * An authorization is valid if:
   *   - It has not been revoked (revokedAt is null)
   *   - It has not expired (expiresAt is null or in the future)
   *   - It covers the specified provider
   *   - It includes the specified commitment type in authorizedCommitments
   *
   * @param provider - The provider/capability to check
   * @param commitmentType - The type of commitment to check
   * @param ownerAuthorizations - Owner authorizations to search
   * @returns true if a valid authorization exists
   */
  checkOwnerAuthorization(
    provider: string,
    commitmentType: ExternalCommitmentType,
    ownerAuthorizations: OwnerAuthorization[],
  ): boolean {
    return ownerAuthorizations.some(
      (auth) =>
        this.isAuthorizationValid(auth) &&
        auth.provider === provider &&
        auth.authorizedCommitments.includes(commitmentType),
    );
  }

  /**
   * Check if a financial commitment amount is within the owner's
   * authorized limit.
   *
   * @param cents - The amount in cents to check
   * @param ownerAuthorizations - Owner authorizations to check against
   * @returns true if at least one valid authorization covers this amount
   */
  checkFinancialLimit(
    cents: number,
    ownerAuthorizations: OwnerAuthorization[],
  ): boolean {
    if (cents <= 0) {
      return true;
    }

    return ownerAuthorizations.some(
      (auth) =>
        this.isAuthorizationValid(auth) &&
        auth.authorizedCommitments.includes('FINANCIAL') &&
        typeof auth.maxFinancialCommitmentCents === 'number' &&
        auth.maxFinancialCommitmentCents >= cents,
    );
  }

  /**
   * Check if a commitment type is allowed to proceed autonomously
   * (without owner authorization).
   *
   * @param commitmentType - The commitment type to check
   * @returns true if autonomous execution is allowed
   */
  isAutonomousAllowed(commitmentType: ExternalCommitmentType): boolean {
    if (this.killSwitchActive && commitmentType !== 'NONE') {
      return false;
    }

    return AUTONOMOUS_COMMITMENT_TYPES.has(commitmentType);
  }

  /**
   * Get the required authorization level for a commitment type.
   *
   * @param commitmentType - The commitment type to check
   * @returns The authorization level (R0-R5), or R5 if unknown
   */
  getRequiredAuthorizationLevel(
    commitmentType: ExternalCommitmentType,
  ): AuthorizationLevel {
    const rule = this.policyRules.get(commitmentType);
    if (!rule) {
      // Unknown commitment types are treated as never authorized
      return 'R5';
    }
    return rule.authorizationLevel;
  }

  /**
   * Get the default policy decision for a commitment type.
   *
   * @param commitmentType - The commitment type to check
   * @returns The default policy decision, or DENY if unknown
   */
  getDefaultDecision(commitmentType: ExternalCommitmentType): PolicyDecision {
    const rule = this.policyRules.get(commitmentType);
    if (!rule) {
      return 'DENY';
    }
    return rule.defaultDecision;
  }

  /**
   * Get all commitment types that require owner authorization.
   */
  getOwnerAuthorizationRequiredTypes(): ExternalCommitmentType[] {
    return DEFAULT_COMMITMENT_POLICIES.filter(
      (rule) => rule.requiresOwnerAuthorization,
    ).map((rule) => rule.commitmentType);
  }

  /**
   * Get all commitment types that are allowed autonomously.
   */
  getAutonomousTypes(): ExternalCommitmentType[] {
    return DEFAULT_COMMITMENT_POLICIES.filter(
      (rule) => !rule.requiresOwnerAuthorization,
    ).map((rule) => rule.commitmentType);
  }

  /**
   * Check if an owner authorization is currently valid (not expired,
   * not revoked).
   */
  private isAuthorizationValid(auth: OwnerAuthorization): boolean {
    // Revoked authorizations are invalid
    if (auth.revokedAt !== null) {
      return false;
    }

    // Check expiration — null means never expires
    if (auth.expiresAt !== null) {
      const now = Date.now();
      const expires = Date.parse(auth.expiresAt);
      if (Number.isNaN(expires) || now >= expires) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Singleton acquisition governance policy instance.
 */
let singletonInstance: AcquisitionGovernancePolicy | null = null;

/**
 * Get the singleton AcquisitionGovernancePolicy instance.
 *
 * @returns The shared AcquisitionGovernancePolicy instance
 */
export function getAcquisitionGovernancePolicy(): AcquisitionGovernancePolicy {
  if (singletonInstance === null) {
    singletonInstance = new AcquisitionGovernancePolicy();
  }
  return singletonInstance;
}
