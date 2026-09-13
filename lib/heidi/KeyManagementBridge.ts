/**
 * Key Management Bridge Adapter
 *
 * Wraps the KeyManagementService and related components so that
 * CognitiveCore's ExecutionBridge interface can invoke key lifecycle
 * operations without knowing the exact native signatures.
 *
 * This adapter is a thin translation layer — it does NOT:
 *   - bypass authorization (KeyPolicyEngine enforces governance)
 *   - fabricate results
 *   - expose secret values
 *
 * The adapter IS the connection between HEIDI's cognitive decision layer
 * and the Key Management Plane.
 */

import type { KeyManagementService } from '../operational/KeyManagementService';
import type { KeyCompromiseResponse } from '../operational/KeyCompromiseResponse';
import type { KeyHealthMonitor } from '../operational/KeyHealthMonitor';
import type { SecretScanner } from '../operational/SecretScanner';
import type { ExecutionBridge } from './CognitiveCore';

/**
 * Create a KeyManagement bridge adapter for the ExecutionBridge.
 */
export function createKeyManagementBridge(
  kms: KeyManagementService,
  compromiseResponse?: KeyCompromiseResponse,
  healthMonitor?: KeyHealthMonitor,
  scanner?: SecretScanner,
): NonNullable<ExecutionBridge['keyManagement']> {
  return {
    async discover() {
      return kms.discover();
    },

    getInventory() {
      return kms.getInventory();
    },

    getKey(keyId: string) {
      return kms.getKey(keyId);
    },

    async validate(keyId: string) {
      return kms.validate(keyId);
    },

    async rotate(keyId: string) {
      return kms.rotate(keyId);
    },

    async revoke(keyId: string) {
      return kms.revoke(keyId);
    },

    async recover(keyId: string) {
      return kms.recover(keyId);
    },

    async generate(providerId: string, options: unknown) {
      return kms.generate(providerId, options as never);
    },

    async respondToCompromise(keyId: string, suspicion: string) {
      if (!compromiseResponse) {
        return {
          success: false,
          message: 'Compromise response not configured',
          keyId,
          stages: [],
        };
      }
      return compromiseResponse.respond(keyId, suspicion);
    },

    async checkHealth() {
      if (!healthMonitor) {
        return { statuses: [], summary: { total: 0, healthy: 0, withFindings: 0, critical: 0, warning: 0, byFindingType: {} } };
      }
      return healthMonitor.checkAll();
    },

    async scan() {
      if (!scanner) {
        return { findings: [], scannedFiles: 0, scannedLines: 0, newFindingsCount: 0, allowlistedCount: 0 };
      }
      return scanner.scan();
    },

    setKillSwitch(active: boolean) {
      kms.setKillSwitch(active);
    },
  };
}
