/**
 * Credential Provisioning Engine
 *
 * Implements the full autonomous provisioning workflow:
 *
 *   REQUEST → IDENTIFY SERVICE → IDENTIFY REQUIRED CREDENTIAL →
 *   DETERMINE MINIMUM PERMISSIONS → CHECK PROVIDER CAPABILITY →
 *   CHECK POLICY → AUTHORIZE → CREATE/REQUEST → STORE →
 *   PROVISION → VALIDATE → RECORD
 *
 * If provider-side creation is unsupported, returns UNSUPPORTED_AUTOMATION
 * with the exact required human/provider action.
 *
 * This does NOT introduce a parallel autonomy pipeline. It composes the
 * existing KeyManagementService and KeyPolicyEngine.
 */

import type {
  KeyMetadata,
  KeyCreationOptions,
  ProvisioningTarget,
  ProvisioningCapability,
  ProvisioningCapabilityResult,
  CredentialType,
} from './KeyManagementTypes';
import type { KeyManagementService } from './KeyManagementService';
import type { KeyProvider } from './KeyManagementTypes';
import type { KeyPolicyEvaluationResult } from './KeyPolicyEngine';

/**
 * A provisioning request.
 */
export interface ProvisioningRequest {
  /** The provider to provision for (e.g., 'stripe', 'sendgrid') */
  provider: string;
  /** The capability that needs this credential (e.g., 'commercial.stripe') */
  capabilityId: string;
  /** The credential type needed */
  credentialType: CredentialType;
  /** The scopes/permissions needed (minimum permissions) */
  scopes: string[];
  /** Human-readable description */
  description: string;
  /** The provisioning target (where the credential should be provisioned) */
  target: ProvisioningTarget;
  /** Whether this is a dry-run */
  dryRun?: boolean;
}

/**
 * Result of a provisioning attempt.
 */
export interface ProvisioningResult {
  /** The provisioning capability result */
  capability: ProvisioningCapability;
  /** Whether the provisioning succeeded */
  success: boolean;
  /** The key ID if a key was created */
  keyId: string | null;
  /** The policy evaluation result */
  policyEvaluation: KeyPolicyEvaluationResult | null;
  /** Evidence/explanation */
  evidence: string;
  /** The exact human action required if automation is not possible */
  requiredHumanAction: string | null;
  /** The authorization level that was required */
  requiredAuthorization: string;
  /** Duration in ms */
  durationMs: number;
}

/**
 * The credential provisioning engine.
 */
export class CredentialProvisioningEngine {
  private kms: KeyManagementService;

  constructor(kms: KeyManagementService) {
    this.kms = kms;
  }

  /**
   * Check whether a credential can be autonomously provisioned for a provider.
   * This does NOT create anything — it just checks capability.
   */
  checkCapability(providerId: string): ProvisioningCapabilityResult {
    const provider = this.kms.getProviders().get(providerId);

    if (!provider) {
      return {
        capability: 'UNSUPPORTED',
        providerSupports: false,
        policyAllows: false,
        requiredHumanAction: `Unknown provider: ${providerId}`,
        requiredAuthorization: 'N/A',
        evidence: `No provider registered with ID '${providerId}'`,
      };
    }

    const providerSupports = provider.supportsKeyCreation;
    const requiredHumanAction = providerSupports
      ? null
      : this.getRequiredHumanAction(providerId, provider);

    // Determine capability level
    let capability: ProvisioningCapability;
    if (providerSupports) {
      // Provider supports creation — check if policy allows it
      capability = 'SUPPORTED'; // Policy check happens at provision time
    } else {
      capability = 'REQUIRES_HUMAN_ACTION';
    }

    return {
      capability,
      providerSupports,
      policyAllows: providerSupports, // Will be checked at provision time
      requiredHumanAction,
      requiredAuthorization: providerSupports ? 'R1/R3' : 'N/A',
      evidence: providerSupports
        ? `Provider '${providerId}' supports autonomous key creation`
        : `Provider '${providerId}' does not support autonomous key creation. ${requiredHumanAction}`,
    };
  }

  /**
   * Provision a credential through the full governed workflow.
   *
   * Workflow:
   *   REQUEST → IDENTIFY → DETERMINE_PERMISSIONS → CHECK_CAPABILITY →
   *   CHECK_POLICY → AUTHORIZE → CREATE → STORE → PROVISION → VALIDATE → RECORD
   */
  async provision(request: ProvisioningRequest): Promise<ProvisioningResult> {
    const start = Date.now();

    // Step 1: IDENTIFY SERVICE — already provided in request

    // Step 2: IDENTIFY REQUIRED CREDENTIAL — already provided in request

    // Step 3: DETERMINE MINIMUM PERMISSIONS — scopes in request

    // Step 4: CHECK PROVIDER CAPABILITY
    const capabilityCheck = this.checkCapability(request.provider);

    if (capabilityCheck.capability === 'UNSUPPORTED' || capabilityCheck.capability === 'REQUIRES_HUMAN_ACTION') {
      return {
        capability: capabilityCheck.capability,
        success: false,
        keyId: null,
        policyEvaluation: null,
        evidence: capabilityCheck.evidence,
        requiredHumanAction: capabilityCheck.requiredHumanAction,
        requiredAuthorization: capabilityCheck.requiredAuthorization,
        durationMs: Date.now() - start,
      };
    }

    // Step 5-6: CHECK POLICY + AUTHORIZE + CREATE + STORE (via KMS.generate)
    const createOptions: KeyCreationOptions = {
      credentialType: request.credentialType,
      scopes: request.scopes,
      description: request.description,
      dryRun: request.dryRun ?? false,
    };

    const generateResult = await this.kms.generate(request.provider, createOptions);

    if (!generateResult.success) {
      // Check if failure was due to unsupported operation
      if (generateResult.failureReason?.includes('does not support')) {
        return {
          capability: 'UNSUPPORTED',
          success: false,
          keyId: null,
          policyEvaluation: generateResult.policyEvaluation,
          evidence: generateResult.failureReason,
          requiredHumanAction: this.getRequiredHumanAction(request.provider, null),
          requiredAuthorization: generateResult.policyEvaluation.requiredAuthorization,
          durationMs: Date.now() - start,
        };
      }

      // Policy denied or other failure
      return {
        capability: 'FAILED',
        success: false,
        keyId: null,
        policyEvaluation: generateResult.policyEvaluation,
        evidence: generateResult.failureReason ?? 'Generation failed',
        requiredHumanAction: null,
        requiredAuthorization: generateResult.policyEvaluation.requiredAuthorization,
        durationMs: Date.now() - start,
      };
    }

    // Step 7: PROVISION
    const provisionResult = await this.kms.provision(generateResult.keyId, request.target);

    if (!provisionResult.success) {
      return {
        capability: 'FAILED',
        success: false,
        keyId: generateResult.keyId,
        policyEvaluation: provisionResult.policyEvaluation,
        evidence: `Created but provisioning failed: ${provisionResult.failureReason}`,
        requiredHumanAction: null,
        requiredAuthorization: provisionResult.policyEvaluation.requiredAuthorization,
        durationMs: Date.now() - start,
      };
    }

    // Step 8: VALIDATE
    const validateResult = await this.kms.validate(generateResult.keyId);

    if (!validateResult.success) {
      return {
        capability: 'FAILED',
        success: false,
        keyId: generateResult.keyId,
        policyEvaluation: validateResult.policyEvaluation,
        evidence: `Created and provisioned but validation failed: ${validateResult.failureReason}`,
        requiredHumanAction: null,
        requiredAuthorization: validateResult.policyEvaluation.requiredAuthorization,
        durationMs: Date.now() - start,
      };
    }

    // Step 9: RECORD — already done by KMS via audit service

    return {
      capability: 'AUTOMATED',
      success: true,
      keyId: generateResult.keyId,
      policyEvaluation: generateResult.policyEvaluation,
      evidence: `Successfully provisioned ${request.provider} credential. ${generateResult.message}. ${validateResult.message}.`,
      requiredHumanAction: null,
      requiredAuthorization: generateResult.policyEvaluation.requiredAuthorization,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Get the exact human action required for a provider that doesn't support
   * autonomous key creation.
   */
  private getRequiredHumanAction(providerId: string, provider: KeyProvider | null): string {
    switch (providerId) {
      case 'google_places':
        return 'Go to Google Cloud Console → APIs & Services → Credentials → Create credentials → API key. Restrict to Places API. Add GOOGLE_PLACES_API_KEY=your-key to .env.local';
      case 'smtp':
        return 'Enable 2-Step Verification on your Google Account → Security → App passwords → Generate one for Mail. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to .env.local';
      default:
        if (provider && !provider.supportsKeyCreation) {
          return `Provider '${providerId}' does not support API-based key creation. Create the key manually in the provider's web console and add it to .env.local`;
        }
        return `Create the ${providerId} credential manually and add it to .env.local`;
    }
  }
}
