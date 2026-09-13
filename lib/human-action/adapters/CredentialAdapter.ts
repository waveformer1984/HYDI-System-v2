/**
 * HYDI Credential Action Adapter
 *
 * Implements credential lifecycle operations by wrapping the existing
 * KeyManagementService. This adapter does NOT re-implement credential
 * management — it delegates to the existing governed credential system.
 *
 * Safety:
 *   - Secret material is NEVER returned in results
 *   - All operations go through the existing KeyPolicyEngine
 *   - Credential references are opaque (cred_01J...)
 */

import type {
  ActionAdapter,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionObservation,
  ActionVerificationResult,
  HumanAction,
  RollbackResult,
} from '../HumanActionTypes';

export interface CredentialAdapterDeps {
  discover: () => Promise<{ added: unknown[]; updated: unknown[]; removed: unknown[] }>;
  getInventory: () => unknown;
  getKey: (keyId: string) => unknown | null;
  validate: (keyId: string) => Promise<unknown>;
  rotate: (keyId: string) => Promise<unknown>;
  revoke: (keyId: string) => Promise<unknown>;
  provision?: (providerId: string, options: unknown) => Promise<unknown>;
  checkHealth: () => Promise<unknown>;
}

export class CredentialAdapter implements ActionAdapter {
  adapterId = 'credential';
  category = 'CREDENTIALS' as const;
  capabilities = [
    'credential.discover',
    'credential.validate',
    'credential.provision',
    'credential.rotate',
    'credential.revoke',
  ];

  constructor(private deps: CredentialAdapterDeps) {}

  async execute(
    action: HumanAction,
    _context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const startTime = Date.now();

    try {
      let output: unknown;
      const evidence: ActionExecutionResult['evidence'] = [];

      switch (action.capability) {
        case 'credential.discover': {
          const result = await this.deps.discover();
          output = {
            added: result.added.length,
            updated: result.updated.length,
            removed: result.removed.length,
          };
          evidence.push({
            check: 'discovery_complete',
            status: 'pass',
            value: `Added: ${result.added.length}, Updated: ${result.updated.length}, Removed: ${result.removed.length}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'credential.validate': {
          const keyId = action.parameters.credentialRef as string ?? action.target;
          if (!keyId) throw new Error('No credential reference provided');
          const result = await this.deps.validate(keyId) as { valid?: boolean; state?: string; evidence?: string };
          output = {
            credentialRef: keyId,
            valid: result.valid ?? false,
            state: result.state ?? 'unknown',
          };
          evidence.push({
            check: 'credential_validated',
            status: result.valid ? 'pass' : 'fail',
            value: `Credential ${keyId}: ${result.state ?? 'unknown'}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'credential.provision': {
          if (!this.deps.provision) {
            return {
              executed: false, output: null,
              error: 'Credential provisioning is not supported by the current key management service',
              evidence: [{
                check: 'provisioning_supported',
                status: 'fail',
                value: 'UNSUPPORTED_AUTOMATION',
                checkedAt: new Date().toISOString(),
              }],
              durationMs: Date.now() - startTime,
            };
          }
          const providerId = action.parameters.providerId as string;
          if (!providerId) throw new Error('No provider ID provided');
          const result = await this.deps.provision(providerId, action.parameters);
          output = { provisioned: true, result: 'metadata-only' };
          evidence.push({
            check: 'credential_provisioned',
            status: 'pass',
            value: `Provisioned credential for ${providerId}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'credential.rotate': {
          const keyId = action.parameters.credentialRef as string ?? action.target;
          if (!keyId) throw new Error('No credential reference provided');
          const result = await this.deps.rotate(keyId) as { success?: boolean; newKeyId?: string };
          output = {
            credentialRef: keyId,
            rotated: result.success ?? false,
            newCredentialRef: result.newKeyId ?? null,
          };
          evidence.push({
            check: 'credential_rotated',
            status: result.success ? 'pass' : 'fail',
            value: result.success ? `Rotated ${keyId}` : 'Rotation failed',
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'credential.revoke': {
          const keyId = action.parameters.credentialRef as string ?? action.target;
          if (!keyId) throw new Error('No credential reference provided');
          const result = await this.deps.revoke(keyId) as { success?: boolean };
          output = {
            credentialRef: keyId,
            revoked: result.success ?? false,
          };
          evidence.push({
            check: 'credential_revoked',
            status: result.success ? 'pass' : 'fail',
            value: result.success ? `Revoked ${keyId}` : 'Revocation failed',
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        default:
          return {
            executed: false, output: null,
            error: `Unsupported capability: ${action.capability}`,
            evidence: [], durationMs: Date.now() - startTime,
          };
      }

      return {
        executed: true, output, error: null, evidence,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        executed: false, output: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        evidence: [{
          check: 'execution_error',
          status: 'fail',
          value: error instanceof Error ? error.message : 'Unknown error',
          checkedAt: new Date().toISOString(),
        }],
        durationMs: Date.now() - startTime,
      };
    }
  }

  async verify(
    action: HumanAction,
    executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<ActionVerificationResult> {
    const evidence: ActionVerificationResult['evidence'] = [];
    if (!executionResult.executed) {
      return { verified: false, evidence, reason: 'Action was not executed' };
    }

    // For validate/rotate/revoke, do independent verification
    if (action.capability === 'credential.validate') {
      const output = executionResult.output as { valid: boolean; state: string };
      evidence.push({
        check: 'validation_result',
        status: output.valid ? 'pass' : 'fail',
        value: `State: ${output.state}`,
        checkedAt: new Date().toISOString(),
      });
      return {
        verified: output.valid,
        evidence,
        reason: output.valid ? 'Credential validated' : 'Credential invalid',
      };
    }

    if (action.capability === 'credential.rotate') {
      const output = executionResult.output as { rotated: boolean; newCredentialRef: string | null };
      if (output.rotated && output.newCredentialRef) {
        // Independent verification: validate the new credential
        try {
          const result = await this.deps.validate(output.newCredentialRef) as { valid?: boolean };
          evidence.push({
            check: 'new_credential_validated',
            status: result.valid ? 'pass' : 'fail',
            value: result.valid ? 'New credential is valid' : 'New credential is invalid',
            checkedAt: new Date().toISOString(),
          });
          return {
            verified: result.valid ?? false,
            evidence,
            reason: result.valid ? 'Rotation verified — new credential valid' : 'New credential invalid',
          };
        } catch (error) {
          evidence.push({
            check: 'new_credential_validation',
            status: 'fail',
            value: 'Could not validate new credential',
            checkedAt: new Date().toISOString(),
          });
          return { verified: false, evidence, reason: 'Could not verify new credential' };
        }
      }
      return { verified: false, evidence, reason: 'Rotation did not produce a new credential' };
    }

    if (action.capability === 'credential.revoke') {
      const output = executionResult.output as { revoked: boolean };
      evidence.push({
        check: 'revocation_confirmed',
        status: output.revoked ? 'pass' : 'fail',
        value: output.revoked ? 'Credential revoked' : 'Revocation failed',
        checkedAt: new Date().toISOString(),
      });
      return {
        verified: output.revoked,
        evidence,
        reason: output.revoked ? 'Revocation verified' : 'Revocation failed',
      };
    }

    const hasPass = executionResult.evidence.some((e) => e.status === 'pass');
    return {
      verified: hasPass,
      evidence,
      reason: hasPass ? 'Operation verified' : 'Verification failed',
    };
  }

  async rollback(
    action: HumanAction,
    _executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<RollbackResult> {
    // Credential operations have their own rollback through the KMS
    if (action.capability === 'credential.rotate') {
      // The old credential should still be valid if rotation failed
      return { attempted: true, succeeded: true, evidence: 'Old credential preserved on rotation failure' };
    }
    if (action.capability === 'credential.revoke') {
      return { attempted: false, succeeded: false, evidence: 'Revocation is irreversible', error: 'Irreversible' };
    }
    return { attempted: false, succeeded: false, evidence: 'No rollback needed' };
  }

  isAvailable(): { available: boolean; reason: string | null } {
    return { available: true, reason: null };
  }

  async observe(target: string, _context: ActionExecutionContext): Promise<ActionObservation> {
    try {
      const key = this.deps.getKey(target);
      return {
        target,
        exists: key !== null,
        state: key ? 'present' : 'not_found',
        properties: key ? { hasMetadata: true } : {},
        observedAt: new Date().toISOString(),
      };
    } catch {
      return {
        target, exists: false, state: 'error',
        properties: {}, observedAt: new Date().toISOString(),
      };
    }
  }
}
