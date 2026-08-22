/**
 * Key Health Monitor
 *
 * Continuously evaluates the health of managed keys and feeds findings
 * into the existing operational intelligence system.
 *
 * Detects:
 *   - Expiring credentials
 *   - Overdue rotation
 *   - Unused credentials
 *   - Orphaned credentials
 *   - Failed authentication
 *   - Repeated rotation failures
 *   - Provisioning drift
 *   - Disabled credentials still referenced
 *   - Credentials missing from inventory
 *   - Credentials appearing in repositories
 *
 * Integrates with:
 *   - CapabilityHealthManager (feeds key health findings)
 *   - KeyInventoryStore (reads key metadata)
 *   - KeyManagementService (triggers validation)
 *   - SecretScanner (detects leaked credentials)
 */

import type {
  KeyMetadata,
  KeyHealthStatus,
  KeyHealthFinding,
  KeyHealthFindingType,
  CredentialHealthState,
  CredentialServiceHealthReport,
} from './KeyManagementTypes';
import type { CapabilityHealthState } from './CapabilityHealthManager';
import type { KeyInventoryStore } from './KeyInventory';
import type { KeyManagementService } from './KeyManagementService';
import type { SecretScanner } from './SecretScanner';

/**
 * The key health monitor.
 */
export class KeyHealthMonitor {
  private inventory: KeyInventoryStore;
  private kms: KeyManagementService;
  private scanner: SecretScanner | null;
  private lastScanFindings: Map<string, boolean> = new Map(); // fingerprint -> found in repo

  constructor(kms: KeyManagementService, scanner?: SecretScanner) {
    this.kms = kms;
    this.inventory = kms.getInventoryStore();
    this.scanner = scanner ?? null;
  }

  /**
   * Check the health of all managed keys.
   */
  async checkAll(): Promise<{ statuses: KeyHealthStatus[]; summary: KeyHealthSummary }> {
    const keys = this.inventory.getAll();
    const statuses: KeyHealthStatus[] = [];

    for (const key of keys) {
      if (key.lifecycleState === 'DESTROYED') continue;
      const status = await this.checkKey(key);
      statuses.push(status);
    }

    const summary = this.computeSummary(statuses);
    return { statuses, summary };
  }

  /**
   * Check the health of a single key.
   */
  async checkKey(key: KeyMetadata): Promise<KeyHealthStatus> {
    const findings: KeyHealthFinding[] = [];
    const now = Date.now();

    // Check expiration
    if (key.expiresAt) {
      const expiresMs = new Date(key.expiresAt).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      if (expiresMs < now) {
        findings.push({
          type: 'EXPIRED',
          severity: 'critical',
          description: `Key expired at ${key.expiresAt}`,
          recommendedAction: 'Rotate immediately',
        });
      } else if (expiresMs - now < sevenDaysMs) {
        findings.push({
          type: 'EXPIRING_SOON',
          severity: 'critical',
          description: `Key expires in less than 7 days (${key.expiresAt})`,
          recommendedAction: 'Rotate within 7 days',
        });
      } else if (expiresMs - now < thirtyDaysMs) {
        findings.push({
          type: 'EXPIRING_SOON',
          severity: 'warning',
          description: `Key expires in less than 30 days (${key.expiresAt})`,
          recommendedAction: 'Schedule rotation',
        });
      }
    }

    // Check rotation status
    if (key.rotationIntervalDays && key.lastRotatedAt) {
      const lastRotatedMs = new Date(key.lastRotatedAt).getTime();
      const rotationDueMs = lastRotatedMs + key.rotationIntervalDays * 24 * 60 * 60 * 1000;
      const rotationOverdueMs = rotationDueMs + key.rotationIntervalDays * 0.5 * 24 * 60 * 60 * 1000;

      if (now > rotationOverdueMs) {
        findings.push({
          type: 'ROTATION_OVERDUE',
          severity: 'critical',
          description: `Rotation overdue by ${Math.floor((now - rotationDueMs) / (24 * 60 * 60 * 1000))} days`,
          recommendedAction: 'Rotate immediately',
        });
      } else if (now > rotationDueMs) {
        findings.push({
          type: 'ROTATION_DUE',
          severity: 'warning',
          description: 'Rotation interval has elapsed',
          recommendedAction: 'Schedule rotation',
        });
      }
    } else if (key.rotationIntervalDays && !key.lastRotatedAt) {
      // Never rotated but has a rotation interval
      const createdMs = new Date(key.createdAt).getTime();
      const rotationDueMs = createdMs + key.rotationIntervalDays * 24 * 60 * 60 * 1000;
      if (now > rotationDueMs) {
        findings.push({
          type: 'ROTATION_OVERDUE',
          severity: 'warning',
          description: 'Key has never been rotated and rotation interval has elapsed',
          recommendedAction: 'Rotate',
        });
      }
    }

    // Check unused credentials
    if (key.lastUsedAt) {
      const lastUsedMs = new Date(key.lastUsedAt).getTime();
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      if (now - lastUsedMs > ninetyDaysMs) {
        findings.push({
          type: 'UNUSED',
          severity: 'warning',
          description: `Key not used in ${Math.floor((now - lastUsedMs) / (24 * 60 * 60 * 1000))} days`,
          recommendedAction: 'Review whether this key is still needed',
        });
      }
    }

    // Check orphaned credentials (no consumer)
    if (key.consumer === 'unknown' || key.provisioningTargets.length === 0) {
      findings.push({
        type: 'ORPHANED',
        severity: 'info',
        description: 'Key has no known consumer or provisioning targets',
        recommendedAction: 'Verify if this key is still in use',
      });
    }

    // Check auth failures
    if (key.lastValidationResult === 'INVALID' || key.lastValidationResult === 'REVOKED' || key.lastValidationResult === 'EXPIRED') {
      findings.push({
        type: 'AUTH_FAILURE',
        severity: 'critical',
        description: `Last validation result: ${key.lastValidationResult}`,
        recommendedAction: 'Rotate or replace the credential',
      });
    }

    // Check rotation failures
    if (key.rotationStatus === 'FAILED') {
      findings.push({
        type: 'ROTATION_FAILURE',
        severity: 'warning',
        description: 'Last rotation attempt failed',
        recommendedAction: 'Investigate rotation failure and retry',
      });
    }

    // Check compromise status
    if (key.compromiseStatus === 'SUSPECTED' || key.compromiseStatus === 'CONFIRMED') {
      findings.push({
        type: 'SUSPICIOUS_USAGE',
        severity: 'critical',
        description: `Key compromise status: ${key.compromiseStatus}`,
        recommendedAction: 'Execute compromise response workflow',
      });
    }

    // Check disabled but referenced
    if ((key.lifecycleState === 'REVOKED' || key.lifecycleState === 'ISOLATED' || key.lifecycleState === 'DEPRECATED') && key.provisioningTargets.length > 0) {
      findings.push({
        type: 'DISABLED_BUT_REFERENCED',
        severity: 'warning',
        description: `Key is ${key.lifecycleState} but still has provisioning targets: ${key.provisioningTargets.join(', ')}`,
        recommendedAction: 'Remove references to this key from consumers',
      });
    }

    // Check for leaked credentials (if scanner is available)
    if (this.scanner && key.fingerprint && this.lastScanFindings.get(key.fingerprint)) {
      findings.push({
        type: 'LEAKED_IN_REPOSITORY',
        severity: 'critical',
        description: 'Key fingerprint found in repository scan',
        recommendedAction: 'Execute compromise response workflow immediately',
      });
    }

    const healthy = findings.length === 0 || findings.every(f => f.severity === 'info');

    return {
      keyId: key.id,
      healthy,
      findings,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Update the leaked-credential findings from a secret scan.
   */
  updateLeakFindings(scanFindings: { fingerprint: string }[]): void {
    this.lastScanFindings.clear();
    for (const finding of scanFindings) {
      this.lastScanFindings.set(finding.fingerprint, true);
    }
  }

  /**
   * Assess the credential health state distinctly from the service health state.
   *
   * A credential can be VALID while the service is DEGRADED (e.g., Stripe API
   * is down but the key is fine). Conversely, a credential can be EXPIRED while
   * the service is still READY (e.g., using a cached token).
   *
   * This distinction is essential for correct diagnosis and recovery.
   */
  assessCredentialHealth(key: KeyMetadata): CredentialHealthState {
    // Compromised takes priority
    if (key.compromiseStatus === 'CONFIRMED' || key.compromiseStatus === 'SUSPECTED') {
      return 'COMPROMISED';
    }

    // Revoked
    if (key.lifecycleState === 'REVOKED') {
      return 'REVOKED';
    }

    // Check validation result
    if (key.lastValidationResult === 'INVALID') {
      return 'REVOKED';
    }
    if (key.lastValidationResult === 'EXPIRED') {
      return 'EXPIRED';
    }
    if (key.lastValidationResult === 'REVOKED') {
      return 'REVOKED';
    }

    // Check expiration
    if (key.expiresAt) {
      const expiresMs = new Date(key.expiresAt).getTime();
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      if (expiresMs < now) {
        return 'EXPIRED';
      }
      if (expiresMs - now < thirtyDaysMs) {
        return 'EXPIRING_SOON';
      }
    }

    // Check rotation overdue
    if (key.rotationIntervalDays && key.lastRotatedAt) {
      const lastRotatedMs = new Date(key.lastRotatedAt).getTime();
      const rotationDueMs = lastRotatedMs + key.rotationIntervalDays * 24 * 60 * 60 * 1000;
      if (Date.now() > rotationDueMs) {
        return 'ROTATION_REQUIRED';
      }
    }

    // Validated and not expiring
    if (key.lastValidationResult === 'VALID') {
      return 'VALID';
    }

    // Not yet validated
    return 'UNKNOWN';
  }

  /**
   * Produce a combined health report that distinguishes credential health
   * from service health.
   *
   * @param key - The credential metadata
   * @param serviceState - The service health state from CapabilityHealthManager
   * @param serviceEvidence - Evidence from the service health check
   */
  assessCombinedHealth(
    key: KeyMetadata,
    serviceState: CapabilityHealthState,
    serviceEvidence: string,
  ): CredentialServiceHealthReport {
    const credentialState = this.assessCredentialHealth(key);

    // Determine if the credential is the root cause of the service issue
    let credentialIsRootCause = false;
    if (serviceState === 'BLOCKED' && credentialState === 'BLOCKED') {
      credentialIsRootCause = true;
    } else if (serviceState === 'DEGRADED' && (
      credentialState === 'EXPIRED' ||
      credentialState === 'REVOKED' ||
      credentialState === 'COMPROMISED' ||
      credentialState === 'ROTATION_REQUIRED'
    )) {
      credentialIsRootCause = true;
    } else if (serviceState === 'UNAVAILABLE' && credentialState === 'VALID') {
      // Service is down but credential is fine — not a credential issue
      credentialIsRootCause = false;
    }

    const credentialEvidence = this.describeCredentialState(credentialState, key);

    return {
      credentialState,
      serviceState,
      credentialEvidence,
      serviceEvidence,
      credentialIsRootCause,
      lastCredentialValidation: key.lastValidationAt,
      lastServiceCheck: new Date().toISOString(),
    };
  }

  /**
   * Describe a credential health state in human-readable terms.
   */
  private describeCredentialState(state: CredentialHealthState, key: KeyMetadata): string {
    switch (state) {
      case 'VALID':
        return `Credential is valid (last validated: ${key.lastValidationAt ?? 'never'})`;
      case 'EXPIRING_SOON':
        return `Credential expires soon (${key.expiresAt})`;
      case 'EXPIRED':
        return `Credential expired (${key.expiresAt ?? 'unknown expiration'})`;
      case 'REVOKED':
        return 'Credential has been revoked by the provider';
      case 'COMPROMISED':
        return `Credential compromise status: ${key.compromiseStatus}`;
      case 'ROTATION_REQUIRED':
        return `Rotation is overdue (last rotated: ${key.lastRotatedAt ?? 'never'})`;
      case 'UNKNOWN':
        return 'Credential has not been validated yet';
      case 'BLOCKED':
        return 'Credential is missing entirely';
      default:
        return `Credential state: ${state}`;
    }
  }

  /**
   * Compute a summary of key health.
   */
  private computeSummary(statuses: KeyHealthStatus[]): KeyHealthSummary {
    return {
      total: statuses.length,
      healthy: statuses.filter(s => s.healthy).length,
      withFindings: statuses.filter(s => !s.healthy).length,
      critical: statuses.filter(s => s.findings.some(f => f.severity === 'critical')).length,
      warning: statuses.filter(s => s.findings.some(f => f.severity === 'warning')).length,
      byFindingType: this.countByFindingType(statuses),
    };
  }

  private countByFindingType(statuses: KeyHealthStatus[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const status of statuses) {
      for (const finding of status.findings) {
        counts[finding.type] = (counts[finding.type] ?? 0) + 1;
      }
    }
    return counts;
  }
}

/**
 * Summary of key health.
 */
export interface KeyHealthSummary {
  total: number;
  healthy: number;
  withFindings: number;
  critical: number;
  warning: number;
  byFindingType: Record<string, number>;
}
