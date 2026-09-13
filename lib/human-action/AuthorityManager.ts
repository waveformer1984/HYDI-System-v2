/**
 * HYDI Delegated Authority Model
 *
 * Implements delegated authority for human actions.
 *
 * HYDI must know:
 *   WHO authorized the task
 *   WHAT HYDI is authorized to do
 *   WHICH resources it can affect
 *   HOW LONG authorization remains valid
 *   WHETHER financial/external/destructive actions require confirmation
 *
 * Never assume that authorization to perform one operation grants
 * authorization to unrelated operations.
 */

import { randomUUID } from 'crypto';
import type {
  AuthorizationScope,
  AuthorizationMode,
  ActionRiskLabel,
} from './HumanActionTypes';
import type { RiskLevel } from '../operational/types';

// ---------------------------------------------------------------------------
// Authority Delegation
// ---------------------------------------------------------------------------

export interface DelegatedAuthority {
  authorityId: string;
  delegatedBy: string;                    // who delegated (e.g. "user:owner")
  delegatedTo: string;                    // who received it (e.g. "heidi")
  scopes: AuthorizationScope[];           // what scopes are granted
  riskLimit: ActionRiskLabel;             // max risk allowed
  riskLevelLimit: RiskLevel;              // max R-level allowed
  resourcePatterns: ResourcePattern[];    // which resources can be affected
  timeConstraint: TimeConstraint;         // how long authorization is valid
  requiresConfirmation: ConfirmationPolicy; // when confirmation is needed
  purpose: string;                        // what this authority is for
  createdAt: string;
  revokedAt?: string;
  metadata: Record<string, unknown>;
}

export interface ResourcePattern {
  type: 'file_path' | 'url' | 'service' | 'credential' | 'repository' | 'any';
  pattern: string;                        // glob/regex/exact
  description: string;
}

export interface TimeConstraint {
  type: 'permanent' | 'time_bounded' | 'session_bounded' | 'single_use';
  expiresAt?: string;                     // ISO timestamp for time_bounded
  sessionId?: string;                     // for session_bounded
  usedAt?: string;                        // for single_use
}

export interface ConfirmationPolicy {
  destructiveActions: boolean;            // confirm before destructive ops
  financialActions: boolean;              // confirm before financial ops
  externalCommunication: boolean;         // confirm before external comms
  deploymentActions: boolean;             // confirm before deployments
  credentialManagement: boolean;          // confirm before credential ops
  highRiskActions: boolean;               // confirm before any HIGH risk
  criticalRiskActions: boolean;           // confirm before any CRITICAL risk
}

// ---------------------------------------------------------------------------
// Default confirmation policies
// ---------------------------------------------------------------------------

export const STRICT_CONFIRMATION: ConfirmationPolicy = {
  destructiveActions: true,
  financialActions: true,
  externalCommunication: true,
  deploymentActions: true,
  credentialManagement: true,
  highRiskActions: true,
  criticalRiskActions: true,
};

export const BALANCED_CONFIRMATION: ConfirmationPolicy = {
  destructiveActions: true,
  financialActions: true,
  externalCommunication: true,
  deploymentActions: true,
  credentialManagement: false,
  highRiskActions: true,
  criticalRiskActions: true,
};

export const PERMISSIVE_CONFIRMATION: ConfirmationPolicy = {
  destructiveActions: true,
  financialActions: true,
  externalCommunication: false,
  deploymentActions: true,
  credentialManagement: false,
  highRiskActions: false,
  criticalRiskActions: true,
};

// ---------------------------------------------------------------------------
// Authority Manager
// ---------------------------------------------------------------------------

export class AuthorityManager {
  private authorities: Map<string, DelegatedAuthority> = new Map();
  private defaultConfirmation: ConfirmationPolicy;

  constructor(defaultConfirmation: ConfirmationPolicy = STRICT_CONFIRMATION) {
    this.defaultConfirmation = defaultConfirmation;
  }

  /**
   * Delegate authority to HYDI or a sub-agent.
   */
  delegate(input: Omit<DelegatedAuthority, 'authorityId' | 'createdAt' | 'metadata' | 'revokedAt'> & {
    metadata?: Record<string, unknown>;
  }): DelegatedAuthority {
    const authority: DelegatedAuthority = {
      authorityId: randomUUID(),
      delegatedBy: input.delegatedBy,
      delegatedTo: input.delegatedTo,
      scopes: input.scopes,
      riskLimit: input.riskLimit,
      riskLevelLimit: input.riskLevelLimit,
      resourcePatterns: input.resourcePatterns,
      timeConstraint: input.timeConstraint,
      requiresConfirmation: input.requiresConfirmation,
      purpose: input.purpose,
      createdAt: new Date().toISOString(),
      metadata: input.metadata ?? {},
    };
    this.authorities.set(authority.authorityId, authority);
    return authority;
  }

  /**
   * Revoke a previously delegated authority.
   */
  revoke(authorityId: string, revokedBy: string): boolean {
    const auth = this.authorities.get(authorityId);
    if (!auth) return false;
    auth.revokedAt = new Date().toISOString();
    auth.metadata.revokedBy = revokedBy;
    return true;
  }

  /**
   * Check if an authority is still valid (not expired, not revoked, not used).
   */
  isAuthorityValid(authorityId: string): { valid: boolean; reason: string | null } {
    const auth = this.authorities.get(authorityId);
    if (!auth) {
      return { valid: false, reason: 'Authority not found' };
    }
    if (auth.revokedAt) {
      return { valid: false, reason: `Authority revoked at ${auth.revokedAt}` };
    }
    const tc = auth.timeConstraint;
    if (tc.type === 'time_bounded' && tc.expiresAt) {
      if (new Date() > new Date(tc.expiresAt)) {
        return { valid: false, reason: `Authority expired at ${tc.expiresAt}` };
      }
    }
    if (tc.type === 'single_use' && tc.usedAt) {
      return { valid: false, reason: `Authority already used at ${tc.usedAt}` };
      }
    return { valid: true, reason: null };
  }

  /**
   * Mark a single-use authority as used.
   */
  markUsed(authorityId: string): void {
    const auth = this.authorities.get(authorityId);
    if (!auth) return;
    if (auth.timeConstraint.type === 'single_use') {
      auth.timeConstraint.usedAt = new Date().toISOString();
    }
  }

  /**
   * Check if an authority covers a specific action.
   */
  checkAuthorization(
    authorityId: string,
    scope: AuthorizationScope,
    risk: RiskLevel,
    riskLabel: ActionRiskLabel,
    target: string,
    category: string,
  ): AuthorizationCheckResult {
    const validity = this.isAuthorityValid(authorityId);
    if (!validity.valid) {
      return {
        authorized: false,
        mode: 'prohibited',
        reason: validity.reason ?? 'Authority invalid',
        requiresConfirmation: false,
        authorityId,
      };
    }

    const auth = this.authorities.get(authorityId)!;

    // Check scope
    if (!auth.scopes.includes(scope)) {
      return {
        authorized: false,
        mode: 'prohibited',
        reason: `Authority does not grant scope '${scope}'. Granted scopes: [${auth.scopes.join(', ')}]`,
        requiresConfirmation: false,
        authorityId,
      };
    }

    // Check risk level
    const riskRank: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4, R5: 5 };
    if (riskRank[risk] > riskRank[auth.riskLevelLimit]) {
      return {
        authorized: false,
        mode: 'prohibited',
        reason: `Action risk ${risk} exceeds authority limit ${auth.riskLevelLimit}`,
        requiresConfirmation: false,
        authorityId,
      };
    }

    // Check resource patterns
    if (auth.resourcePatterns.length > 0) {
      const matches = auth.resourcePatterns.some((p) => this.matchPattern(p, target, category));
      if (!matches) {
        return {
          authorized: false,
          mode: 'prohibited',
          reason: `Target '${target}' does not match any authorized resource pattern`,
          requiresConfirmation: false,
          authorityId,
        };
      }
    }

    // Determine authorization mode and confirmation requirement
    const mode = this.determineAuthorizationMode(risk, auth);
    const requiresConfirmation = this.requiresConfirmation(riskLabel, category, auth.requiresConfirmation);

    return {
      authorized: mode !== 'prohibited',
      mode,
      reason: mode === 'prohibited'
        ? `Action prohibited by authority policy`
        : `Authorized under authority ${authorityId}`,
      requiresConfirmation,
      authorityId,
    };
  }

  /**
   * Get all active authorities.
   */
  getActiveAuthorities(): DelegatedAuthority[] {
    return Array.from(this.authorities.values()).filter((a) => !a.revokedAt);
  }

  /**
   * Get an authority by ID.
   */
  getAuthority(authorityId: string): DelegatedAuthority | null {
    return this.authorities.get(authorityId) ?? null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private determineAuthorizationMode(risk: RiskLevel, auth: DelegatedAuthority): AuthorizationMode {
    const riskRank: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4, R5: 5 };
    const limit = riskRank[auth.riskLevelLimit];
    const action = riskRank[risk];

    // R5 is always prohibited for autonomous execution
    if (risk === 'R5') {
      return 'human_required';
    }
    // R4 requires human
    if (risk === 'R4') {
      return 'human_required';
    }
    // R3 requires human
    if (risk === 'R3') {
      return 'human_required';
    }
    // R2 is policy_authorized if within limit
    if (risk === 'R2' && action <= limit) {
      return 'policy_authorized';
    }
    // R0-R1 is autonomous if within limit
    if (action <= limit) {
      return 'autonomous';
    }
    return 'prohibited';
  }

  private requiresConfirmation(
    riskLabel: ActionRiskLabel,
    category: string,
    policy: ConfirmationPolicy,
  ): boolean {
    if (riskLabel === 'CRITICAL' && policy.criticalRiskActions) return true;
    if (riskLabel === 'HIGH' && policy.highRiskActions) return true;
    if (category === 'FINANCIAL' && policy.financialActions) return true;
    if (category === 'COMMUNICATION' && policy.externalCommunication) return true;
    if (category === 'DEVELOPMENT' && policy.deploymentActions) return true;
    // Only require confirmation for credential MANAGEMENT (not discovery/validation)
    if (category === 'CREDENTIALS' && riskLabel !== 'LOW' && policy.credentialManagement) return true;
    if (category === 'SYSTEM' && riskLabel === 'HIGH' && policy.destructiveActions) return true;
    return false;
  }

  private matchPattern(pattern: ResourcePattern, target: string, _category: string): boolean {
    if (pattern.type === 'any') return true;
    if (pattern.type === 'file_path') {
      return this.globMatch(pattern.pattern, target);
    }
    if (pattern.type === 'url') {
      return target.startsWith(pattern.pattern) || this.globMatch(pattern.pattern, target);
    }
    if (pattern.type === 'service' || pattern.type === 'credential' || pattern.type === 'repository') {
      return target === pattern.pattern || this.globMatch(pattern.pattern, target);
    }
    return false;
  }

  private globMatch(pattern: string, text: string): boolean {
    // Simple glob matching: * matches any chars, ? matches one char
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(text);
  }
}

export interface AuthorizationCheckResult {
  authorized: boolean;
  mode: AuthorizationMode;
  reason: string;
  requiresConfirmation: boolean;
  authorityId: string;
}

/**
 * Create a default owner authority — grants HYDI broad authority
 * with strict confirmation for high-risk actions.
 */
export function createOwnerAuthority(
  owner: string = 'user:owner',
  scopes: AuthorizationScope[] = ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION'],
  confirmation: ConfirmationPolicy = STRICT_CONFIRMATION,
): DelegatedAuthority {
  const mgr = new AuthorityManager(confirmation);
  return mgr.delegate({
    delegatedBy: owner,
    delegatedTo: 'heidi',
    scopes,
    riskLimit: 'HIGH',
    riskLevelLimit: 'R4',
    resourcePatterns: [{ type: 'any', pattern: '*', description: 'All resources' }],
    timeConstraint: { type: 'session_bounded', sessionId: 'default' },
    requiresConfirmation: confirmation,
    purpose: 'General HYDI operation authority',
  });
}
