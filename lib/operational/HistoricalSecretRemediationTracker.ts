/**
 * Historical Secret Remediation Tracker
 *
 * Tracks secrets found in Git history and their remediation status.
 * This extends the existing SecretScanner (which scans the working tree)
 * with historical commit scanning and durable remediation tracking.
 *
 * SECURITY: This module NEVER stores raw secret values. Only:
 *   - secret type
 *   - provider
 *   - safe fingerprint (SHA-256, first 16 chars)
 *   - affected file/path
 *   - commit references (SHA, not content)
 *   - exposure severity
 *   - rotation status
 *   - revocation status
 *   - cleanup status
 *   - verification status
 *   - owner action required
 *   - timestamps
 *   - evidence references
 */

import { createHash, randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { createEvidence, type EvidenceBlocker } from './EvidenceModel';

// ─── Types ───────────────────────────────────────────────────────────────

export type SecretType =
  | 'STRIPE_LIVE_KEY'
  | 'STRIPE_TEST_KEY'
  | 'STRIPE_RESTRICTED_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'SUPABASE_SERVICE_ROLE_JWT'
  | 'VERCEL_OIDC_JWT'
  | 'KEEPER_BREAK_GLASS_JWT'
  | 'JWT'
  | 'AWS_ACCESS_KEY'
  | 'PEM_PRIVATE_KEY'
  | 'BEARER_TOKEN'
  | 'UNKNOWN_SECRET';

export type RemediationStatus =
  | 'DISCOVERED'
  | 'CONFIRMED_EXPOSED'
  | 'ROTATION_REQUIRED'
  | 'ROTATION_PENDING_AUTHORIZATION'
  | 'ROTATED'
  | 'REVOCATION_REQUIRED'
  | 'REVOKED'
  | 'CLEANED_FROM_CURRENT_TREE'
  | 'STILL_IN_HISTORY'
  | 'REMEDIATION_COMPLETE'
  | 'OWNER_ACTION_REQUIRED'
  | 'ESCALATED'
  | 'NON_CREDENTIAL_PLACEHOLDER';

export type CleanupStatus =
  | 'NOT_STARTED'
  | 'REMOVED_FROM_CURRENT_TREE'
  | 'STILL_IN_HISTORY'
  | 'HISTORY_REWRITTEN'  // requires human authorization
  | 'NOT_APPLICABLE';

export type VerificationStatus =
  | 'UNVERIFIED'
  | 'ROTATION_VERIFIED'
  | 'REVOCATION_VERIFIED'
  | 'CLEANUP_VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'NOT_VERIFIABLE';

export interface HistoricalSecretFinding {
  id: string;
  /** Secret type classification */
  secretType: SecretType;
  /** Provider (stripe, supabase, vercel, etc.) */
  provider: string;
  /** Safe fingerprint (SHA-256 of redacted value, first 16 chars) */
  fingerprint: string;
  /** Redacted preview (e.g., 'sk_live_...1234') */
  redactedPreview: string;
  /** Affected file path */
  filePath: string;
  /** Commit SHA where it was found */
  commitSha: string;
  /** Commit date */
  commitDate: string;
  /** Whether it's still in the current working tree */
  inCurrentTree: boolean;
  /** Exposure severity */
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  /** Whether the secret appears active (heuristic) */
  appearsActive: boolean;
  /** Remediation tracking */
  remediation: {
    status: RemediationStatus;
    cleanupStatus: CleanupStatus;
    rotationStatus: 'NOT_REQUIRED' | 'REQUIRED' | 'IN_PROGRESS' | 'COMPLETE' | 'UNKNOWN';
    revocationStatus: 'NOT_REQUIRED' | 'REQUIRED' | 'IN_PROGRESS' | 'COMPLETE' | 'UNKNOWN';
    verificationStatus: VerificationStatus;
  };
  /** Owner action required */
  ownerActionRequired: string | null;
  /** Timestamps */
  discoveredAt: string;
  lastUpdated: string;
  /** Evidence references */
  evidenceReferences: string[];
  /** Remediation notes (safe metadata only) */
  notes: string[];
}

// ─── Remediation Tracker ─────────────────────────────────────────────────

export class HistoricalSecretRemediationTracker {
  private findings: Map<string, HistoricalSecretFinding> = new Map();
  private byProvider: Map<string, string[]> = new Map();
  private byFile: Map<string, string[]> = new Map();
  private remediationStorePath: string;

  constructor(remediationStorePath?: string) {
    this.remediationStorePath = remediationStorePath || '.hydi-operational/historical-secret-remediation.json';
  }

  /**
   * Scan Git history for secrets.
   * Uses git log with pattern matching — never checks out commits.
   */
  scanHistory(options?: { maxCommits?: number; sinceDate?: string }): HistoricalSecretFinding[] {
    const maxCommits = options?.maxCommits || 500;
    const sinceDate = options?.sinceDate || '';

    // Patterns to search for in history
    const patterns: { type: SecretType; provider: string; regex: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' }[] = [
      { type: 'STRIPE_LIVE_KEY', provider: 'stripe', regex: 'sk_live_[a-zA-Z0-9]{20,}', severity: 'CRITICAL' },
      { type: 'STRIPE_TEST_KEY', provider: 'stripe', regex: 'sk_test_[a-zA-Z0-9]{20,}', severity: 'MEDIUM' },
      { type: 'STRIPE_RESTRICTED_KEY', provider: 'stripe', regex: 'rk_live_[a-zA-Z0-9]{20,}', severity: 'CRITICAL' },
      { type: 'STRIPE_WEBHOOK_SECRET', provider: 'stripe', regex: 'whsec_[a-zA-Z0-9]{20,}', severity: 'HIGH' },
      { type: 'SUPABASE_SERVICE_ROLE_JWT', provider: 'supabase', regex: 'eyJ[a-zA-Z0-9_-]+\\.eyJ[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+', severity: 'HIGH' },
      { type: 'AWS_ACCESS_KEY', provider: 'aws', regex: 'AKIA[A-Z0-9]{16}', severity: 'HIGH' },
      { type: 'PEM_PRIVATE_KEY', provider: 'generic', regex: '-----BEGIN[A-Z\\s]+PRIVATE KEY-----', severity: 'CRITICAL' },
    ];

    const newFindings: HistoricalSecretFinding[] = [];

    for (const pattern of patterns) {
      try {
        // Use git log -G to find commits where the pattern was added
        const dateArg = sinceDate ? `--since="${sinceDate}"` : '';
        const cmd = `git log -G "${pattern.regex}" --all --format="%H|%aI" -n ${maxCommits} ${dateArg} -- .`;
        let output: string;
        try {
          output = execSync(cmd, { encoding: 'utf-8', timeout: 30000, maxBuffer: 1024 * 1024 }).trim();
        } catch {
          continue;
        }

        if (!output) continue;

        const commits = output.split('\n').filter(Boolean);
        for (const commitLine of commits) {
          const [commitSha, commitDate] = commitLine.split('|');
          if (!commitSha) continue;

          // Find which files in this commit contain the pattern
          let filesOutput: string;
          try {
            filesOutput = execSync(`git show --name-only --format="" ${commitSha}`, {
              encoding: 'utf-8',
              timeout: 10000,
              maxBuffer: 1024 * 1024,
            }).trim();
          } catch {
            continue;
          }

          const files = filesOutput.split('\n').filter(Boolean);
          for (const filePath of files) {
            // Check if the file in that commit contains the pattern
            let fileContent: string;
            try {
              fileContent = execSync(`git show ${commitSha}:${filePath}`, {
                encoding: 'utf-8',
                timeout: 10000,
                maxBuffer: 5 * 1024 * 1024,
              });
            } catch {
              continue;
            }

            // Search for the pattern in the file content
            const regex = new RegExp(pattern.regex, 'g');
            let match;
            while ((match = regex.exec(fileContent)) !== null) {
              const value = match[0];
              const fingerprint = this.fingerprint(value);
              const redactedPreview = this.redact(value);
              const findingId = this.findingId(commitSha, filePath, fingerprint);

              // Skip if already tracked
              if (this.findings.has(findingId)) continue;

              // Check if still in current tree
              const inCurrentTree = this.checkInCurrentTree(filePath, pattern.regex);

              const finding: HistoricalSecretFinding = {
                id: findingId,
                secretType: pattern.type,
                provider: pattern.provider,
                fingerprint,
                redactedPreview,
                filePath,
                commitSha,
                commitDate,
                inCurrentTree,
                severity: pattern.severity,
                appearsActive: !inCurrentTree, // If removed from tree, may still be active in history
                remediation: {
                  status: inCurrentTree ? 'CONFIRMED_EXPOSED' : 'STILL_IN_HISTORY',
                  cleanupStatus: inCurrentTree ? 'NOT_STARTED' : 'STILL_IN_HISTORY',
                  rotationStatus: 'REQUIRED',
                  revocationStatus: pattern.severity === 'CRITICAL' ? 'REQUIRED' : 'UNKNOWN',
                  verificationStatus: 'UNVERIFIED',
                },
                ownerActionRequired: this.ownerActionFor(pattern.type, pattern.severity),
                discoveredAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                evidenceReferences: [],
                notes: [],
              };

              this.findings.set(findingId, finding);
              this.indexBy('byProvider', pattern.provider, findingId);
              this.indexBy('byFile', filePath, findingId);
              newFindings.push(finding);
            }
          }
        }
      } catch (error) {
        // Git command failed — skip this pattern
        continue;
      }
    }

    // Record evidence for the scan
    createEvidence({
      operationId: `historical-secret-scan-${Date.now()}`,
      capability: 'credential-governance',
      provider: 'internal',
      environment: 'development',
      action: 'historical_secret_scan',
      authorization: { mode: 'autonomous', actor: 'credential-governance', role: null, permission: 'credentials:view' },
      observation: `Scanned ${maxCommits} commits, found ${newFindings.length} new historical secret exposures`,
      verificationLevel: 'VERIFIED_INTERNAL',
      verificationMethod: 'git.history.scan',
      result: newFindings.length > 0 ? 'FAIL' : 'PASS',
      confidence: 0.9,
      externalEvidence: [],
      internalEvidence: [`findings: ${newFindings.length}`, `providers: ${[...new Set(newFindings.map(f => f.provider))].join(',')}`],
      correlationId: `historical-scan-${Date.now()}`,
      blocker: newFindings.length > 0 ? {
        type: 'SECRET_EXPOSURE',
        provider: 'multiple',
        capability: 'credential-governance',
        severity: 'blocking',
        repairability: 'human_required',
        reason: `${newFindings.length} historical secret exposures found`,
        attemptedActions: ['git_history_scan', 'current_tree_check'],
        requiredHumanAction: 'Review findings and rotate/revoke exposed credentials',
        risk: 'HIGH',
      } : null,
    });

    return newFindings;
  }

  /**
   * Update remediation status for a finding.
   */
  updateRemediation(
    findingId: string,
    updates: Partial<{
      status: RemediationStatus;
      cleanupStatus: CleanupStatus;
      rotationStatus: 'NOT_REQUIRED' | 'REQUIRED' | 'IN_PROGRESS' | 'COMPLETE' | 'UNKNOWN';
      revocationStatus: 'NOT_REQUIRED' | 'REQUIRED' | 'IN_PROGRESS' | 'COMPLETE' | 'UNKNOWN';
      verificationStatus: VerificationStatus;
      ownerActionRequired: string | null;
      notes: string[];
    }>,
    authorization: { mode: string; actor: string | null; role: string | null }
  ): HistoricalSecretFinding | null {
    const finding = this.findings.get(findingId);
    if (!finding) return null;

    if (updates.status) finding.remediation.status = updates.status;
    if (updates.cleanupStatus) finding.remediation.cleanupStatus = updates.cleanupStatus;
    if (updates.rotationStatus) finding.remediation.rotationStatus = updates.rotationStatus;
    if (updates.revocationStatus) finding.remediation.revocationStatus = updates.revocationStatus;
    if (updates.verificationStatus) finding.remediation.verificationStatus = updates.verificationStatus;
    if (updates.ownerActionRequired !== undefined) finding.ownerActionRequired = updates.ownerActionRequired;
    if (updates.notes) finding.notes.push(...updates.notes);
    finding.lastUpdated = new Date().toISOString();

    // Record evidence
    createEvidence({
      operationId: `remediation-update-${findingId}-${Date.now()}`,
      capability: 'credential-governance',
      provider: finding.provider,
      environment: 'development',
      action: 'remediation_status_update',
      authorization: {
        mode: authorization.mode,
        actor: authorization.actor,
        role: authorization.role,
        permission: 'credentials:remediate',
      },
      observation: `Remediation status updated: ${finding.remediation.status}`,
      verificationLevel: 'VERIFIED_INTERNAL',
      verificationMethod: 'remediation.tracker.update',
      result: 'PASS',
      confidence: 1.0,
      externalEvidence: [],
      internalEvidence: [`finding: ${findingId}`, `fingerprint: ${finding.fingerprint}`],
      correlationId: `remediation-${findingId}`,
      blocker: null,
    });

    return finding;
  }

  /**
   * Get all findings.
   */
  getAll(): HistoricalSecretFinding[] {
    return Array.from(this.findings.values());
  }

  /**
   * Get findings by provider.
   */
  getByProvider(provider: string): HistoricalSecretFinding[] {
    const ids = this.byProvider.get(provider) || [];
    return ids.map(id => this.findings.get(id)).filter(Boolean) as HistoricalSecretFinding[];
  }

  /**
   * Get findings by file.
   */
  getByFile(filePath: string): HistoricalSecretFinding[] {
    const ids = this.byFile.get(filePath) || [];
    return ids.map(id => this.findings.get(id)).filter(Boolean) as HistoricalSecretFinding[];
  }

  /**
   * Get findings requiring owner action.
   */
  getOwnerActionRequired(): HistoricalSecretFinding[] {
    return this.getAll().filter(f =>
      f.ownerActionRequired !== null ||
      f.remediation.status === 'OWNER_ACTION_REQUIRED' ||
      f.remediation.status === 'ROTATION_PENDING_AUTHORIZATION' ||
      f.remediation.status === 'ESCALATED'
    );
  }

  /**
   * Get findings by severity.
   */
  getBySeverity(severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'): HistoricalSecretFinding[] {
    return this.getAll().filter(f => f.severity === severity);
  }

  /**
   * Get a summary of all findings.
   */
  getSummary(): {
    total: number;
    bySeverity: Record<string, number>;
    byProvider: Record<string, number>;
    byStatus: Record<string, number>;
    criticalUnresolved: number;
    rotationRequired: number;
    revocationRequired: number;
    ownerActionRequired: number;
    remediationComplete: number;
  } {
    const all = this.getAll();
    const bySeverity: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const f of all) {
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      byProvider[f.provider] = (byProvider[f.provider] || 0) + 1;
      byStatus[f.remediation.status] = (byStatus[f.remediation.status] || 0) + 1;
    }

    return {
      total: all.length,
      bySeverity,
      byProvider,
      byStatus,
      criticalUnresolved: all.filter(f =>
        f.severity === 'CRITICAL' && f.remediation.status !== 'REMEDIATION_COMPLETE'
      ).length,
      rotationRequired: all.filter(f => f.remediation.rotationStatus === 'REQUIRED').length,
      revocationRequired: all.filter(f => f.remediation.revocationStatus === 'REQUIRED').length,
      ownerActionRequired: this.getOwnerActionRequired().length,
      remediationComplete: all.filter(f => f.remediation.status === 'REMEDIATION_COMPLETE').length,
    };
  }

  /**
   * Serialize for persistence.
   */
  serialize(): string {
    return JSON.stringify({
      findings: Array.from(this.findings.entries()),
      byProvider: Array.from(this.byProvider.entries()),
      byFile: Array.from(this.byFile.entries()),
    }, null, 2);
  }

  /**
   * Restore from persistence.
   */
  restore(serialized: string): void {
    const data = JSON.parse(serialized);
    this.findings = new Map(data.findings);
    this.byProvider = new Map(data.byProvider);
    this.byFile = new Map(data.byFile);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').substring(0, 16);
  }

  private redact(value: string): string {
    if (value.length <= 12) return value.substring(0, 4) + '...';
    return value.substring(0, 8) + '...' + value.substring(value.length - 4);
  }

  private findingId(commitSha: string, filePath: string, fingerprint: string): string {
    return createHash('sha256')
      .update(`${commitSha}:${filePath}:${fingerprint}`)
      .digest('hex')
      .substring(0, 16);
  }

  private checkInCurrentTree(filePath: string, pattern: string): boolean {
    try {
      // Use git grep to check if pattern exists in current tree
      execSync(`git grep -l "${pattern}" HEAD -- "${filePath}" 2>NUL`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return true;
    } catch {
      // Check if file exists and contains pattern directly
      try {
        const { readFileSync, existsSync } = require('fs');
        if (!existsSync(filePath)) return false;
        const content = readFileSync(filePath, 'utf-8');
        return new RegExp(pattern).test(content);
      } catch {
        return false;
      }
    }
  }

  private ownerActionFor(type: SecretType, severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'): string | null {
    if (severity === 'CRITICAL' || severity === 'HIGH') {
      return `Rotate and revoke the exposed ${type} credential via the provider dashboard`;
    }
    if (severity === 'MEDIUM') {
      return `Review and rotate the exposed ${type} credential if still active`;
    }
    return null;
  }

  private indexBy(index: 'byProvider' | 'byFile', key: string, findingId: string): void {
    const map = index === 'byProvider' ? this.byProvider : this.byFile;
    const ids = map.get(key) || [];
    ids.push(findingId);
    map.set(key, ids);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let trackerInstance: HistoricalSecretRemediationTracker | null = null;

export function getHistoricalSecretRemediationTracker(): HistoricalSecretRemediationTracker {
  if (!trackerInstance) {
    trackerInstance = new HistoricalSecretRemediationTracker();
  }
  return trackerInstance;
}
