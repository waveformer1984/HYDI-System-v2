/**
 * HYDI Delegated Identity Model
 *
 * Extends the existing DelegatedAuthority with identity-bound context.
 *
 * DelegatedAuthority answers: "WHAT is HYDI authorized to do?"
 * DelegatedIdentity answers: "WHO is HYDI acting for, and under what
 *   session/context, and what always requires human confirmation
 *   regardless of authority?"
 *
 * A DelegatedIdentity wraps a DelegatedAuthority and adds:
 *   - The user identity HYDI is acting for
 *   - The session that initiated the goal
 *   - When delegation began and when it expires
 *   - Capabilities explicitly included
 *   - Capabilities explicitly excluded (deny-list, overrides authority)
 *   - Actions that ALWAYS require human confirmation (overrides authority)
 *   - Resource boundaries (allow/deny per resource type)
 *
 * Delegation must never silently expand itself.
 * Replanning must not create new authority.
 */

import { randomUUID } from 'crypto';
import os from 'os';
import type { DelegatedAuthority, ConfirmationPolicy } from '../human-action/AuthorityManager';
import type { AuthorizationScope, AuthorizationMode, ActionCategory } from '../human-action/HumanActionTypes';
import type { RiskLevel } from '../operational/types';

// ---------------------------------------------------------------------------
// Resource Boundary
// ---------------------------------------------------------------------------

/**
 * A resource boundary defines what resources HYDI may or may not
 * interact with, independent of the action being performed.
 *
 * The resource itself matters — not just the action name.
 * filesystem.write may be allowed for C:\Users\Owner\HYDI_System\workspace
 * but denied for C:\Windows.
 */
export interface ResourceBoundary {
  /** Resource type this boundary applies to */
  resourceType: ResourceBoundaryType;
  /** Whether this is an allow or deny rule */
  effect: 'allow' | 'deny';
  /** Pattern to match the resource identifier (glob, regex, or exact) */
  pattern: string;
  /** Pattern matching mode */
  matchMode: 'glob' | 'regex' | 'exact' | 'prefix';
  /** Human-readable reason for this boundary */
  reason: string;
}

export type ResourceBoundaryType =
  | 'filesystem_path'    // file or directory path
  | 'domain'             // web domain (e.g. "stripe.com")
  | 'api_endpoint'       // API URL pattern
  | 'repository'         // git repository path
  | 'service'            // named service (e.g. "heidi-web")
  | 'process'            // process name pattern
  | 'browser_origin'     // browser navigation origin
  | 'deployment_target'  // deployment destination
  | 'credential_ref'     // credential reference pattern
  | 'port'               // network port
  | 'command';           // shell command pattern

// ---------------------------------------------------------------------------
// Side Effect Category
// ---------------------------------------------------------------------------

/**
 * Categorization of side effects produced by actions.
 * Each category has an explicit policy.
 */
export type SideEffectCategory =
  | 'READ'                // autonomous where authorized
  | 'CREATE'              // bounded autonomy
  | 'MODIFY'              // resource-scoped
  | 'DELETE'              // human confirmation by default
  | 'COMMUNICATE'         // confirmation unless explicitly delegated
  | 'AUTHENTICATE'        // always logged, may require human
  | 'FINANCIAL'           // human confirmation always
  | 'DEPLOY'              // policy-dependent
  | 'EXTERNAL_COMMITMENT'; // human confirmation always

/**
 * Policy for a side effect category.
 */
export interface SideEffectPolicy {
  category: SideEffectCategory;
  /** Whether this category is allowed at all */
  allowed: boolean;
  /** Whether human confirmation is required */
  requiresHumanConfirmation: boolean;
  /** Maximum allowed risk level for this category */
  maxRiskLevel: RiskLevel;
  /** Whether this counts against the external side effect budget */
  countsAsExternal: boolean;
  /** Whether this counts against the destructive action budget */
  countsAsDestructive: boolean;
  /** Human-readable reason */
  reason: string;
}

// ---------------------------------------------------------------------------
// Delegated Identity
// ---------------------------------------------------------------------------

/**
 * A governed delegated identity.
 *
 * This is NOT a parallel authority system — it wraps DelegatedAuthority
 * and adds identity context, resource boundaries, and always-confirm
 * rules that the existing AuthorityManager does not enforce.
 */
export interface DelegatedIdentity {
  /** Unique identity ID */
  identityId: string;
  /** The user HYDI is acting for (e.g. "user:owner") */
  userId: string;
  /** The session that initiated this delegation */
  sessionId: string;
  /** The underlying authority granted by AuthorityManager */
  authority: DelegatedAuthority;
  /** When delegation began */
  delegatedAt: string;
  /** When delegation expires (ISO timestamp) */
  expiresAt: string;
  /** Capabilities explicitly included (allowlist) */
  includedCapabilities: string[];
  /** Capabilities explicitly excluded (denylist — overrides authority) */
  excludedCapabilities: string[];
  /** Actions that ALWAYS require human confirmation, regardless of authority */
  alwaysConfirmActions: string[];
  /** Resource boundaries (allow/deny per resource type) */
  resourceBoundaries: ResourceBoundary[];
  /** Side effect policies per category */
  sideEffectPolicies: SideEffectPolicy[];
  /** The purpose of this delegation */
  purpose: string;
  /** Whether delegation has been revoked */
  revokedAt?: string;
}

// ---------------------------------------------------------------------------
// Authority Evaluation Context
// ---------------------------------------------------------------------------

/**
 * The full context for an authority evaluation.
 *
 * Authority is evaluated against:
 *   IDENTITY + CAPABILITY + ACTION + RESOURCE + RISK + CONTEXT + POLICY
 */
export interface AuthorityEvaluationContext {
  /** The delegated identity making the request */
  identity: DelegatedIdentity;
  /** The capability being requested (e.g. "filesystem.write_file") */
  capability: string;
  /** The action category */
  category: ActionCategory;
  /** The target resource identifier (path, URL, process name, etc.) */
  target: string;
  /** The risk level of the action */
  risk: RiskLevel;
  /** The authorization scope required */
  scope: AuthorizationScope;
  /** The authorization mode requested */
  mode: AuthorizationMode;
  /** The resource type of the target */
  resourceType: ResourceBoundaryType;
  /** The side effect category this action produces */
  sideEffectCategory: SideEffectCategory;
  /** Additional context (e.g. "browser_login_flow") */
  context?: string;
}

/**
 * Result of an authority evaluation.
 */
export interface AuthorityEvaluationResult {
  /** Whether the action is authorized */
  authorized: boolean;
  /** Whether human confirmation is required */
  requiresConfirmation: boolean;
  /** The reason for the decision */
  reason: string;
  /** Which boundary or policy triggered the denial, if any */
  deniedBy?: 'excluded_capability' | 'resource_boundary' | 'side_effect_policy' | 'risk_limit' | 'scope_limit' | 'expired' | 'revoked' | 'always_confirm';
  /** The identity that was evaluated */
  identityId: string;
  /** The authority that was evaluated */
  authorityId: string;
}

// ---------------------------------------------------------------------------
// Delegated Identity Manager
// ---------------------------------------------------------------------------

/**
 * Manages delegated identities and evaluates authority against the
 * full context: IDENTITY + CAPABILITY + ACTION + RESOURCE + RISK + CONTEXT + POLICY
 *
 * This sits ABOVE AuthorityManager and delegates to it for scope/risk
 * checks. It adds:
 *   - Identity-bound context
 *   - Resource boundary enforcement
 *   - Side effect categorization
 *   - Always-confirm rules
 *   - Capability exclusion (deny-list)
 *   - Expiry enforcement
 */
export class DelegatedIdentityManager {
  private identities = new Map<string, DelegatedIdentity>();
  private sessionToIdentity = new Map<string, string>();

  /**
   * Create a delegated identity.
   * Does NOT modify the underlying AuthorityManager — the authority
   * must already exist.
   */
  delegate(input: Omit<DelegatedIdentity, 'identityId' | 'delegatedAt' | 'revokedAt'>): DelegatedIdentity {
    const identityId = `identity_${randomUUID()}`;
    const delegatedAt = new Date().toISOString();

    const identity: DelegatedIdentity = {
      ...input,
      identityId,
      delegatedAt,
    };

    this.identities.set(identityId, identity);
    this.sessionToIdentity.set(input.sessionId, identityId);
    return identity;
  }

  /**
   * Revoke a delegated identity.
   */
  revoke(identityId: string, revokedBy: string): boolean {
    const identity = this.identities.get(identityId);
    if (!identity) return false;
    identity.revokedAt = new Date().toISOString();
    this.sessionToIdentity.delete(identity.sessionId);
    return true;
  }

  /**
   * Get a delegated identity by ID.
   */
  getIdentity(identityId: string): DelegatedIdentity | null {
    return this.identities.get(identityId) ?? null;
  }

  /**
   * Get a delegated identity by session ID.
   */
  getIdentityBySession(sessionId: string): DelegatedIdentity | null {
    const identityId = this.sessionToIdentity.get(sessionId);
    if (!identityId) return null;
    return this.identities.get(identityId) ?? null;
  }

  /**
   * Check if a delegated identity is still valid (not expired, not revoked).
   */
  isIdentityValid(identityId: string): { valid: boolean; reason: string | null } {
    const identity = this.identities.get(identityId);
    if (!identity) {
      return { valid: false, reason: 'Identity not found' };
    }
    if (identity.revokedAt) {
      return { valid: false, reason: `Identity revoked at ${identity.revokedAt}` };
    }
    const now = Date.now();
    const expires = new Date(identity.expiresAt).getTime();
    if (now > expires) {
      return { valid: false, reason: `Identity expired at ${identity.expiresAt}` };
    }
    return { valid: true, reason: null };
  }

  /**
   * Evaluate an authority request against the full context.
   *
   * IDENTITY + CAPABILITY + ACTION + RESOURCE + RISK + CONTEXT + POLICY
   */
  evaluate(ctx: AuthorityEvaluationContext): AuthorityEvaluationResult {
    // 1. Check identity validity
    const validity = this.isIdentityValid(ctx.identity.identityId);
    if (!validity.valid) {
      return {
        authorized: false,
        requiresConfirmation: false,
        reason: validity.reason ?? 'Identity invalid',
        deniedBy: 'expired',
        identityId: ctx.identity.identityId,
        authorityId: ctx.identity.authority.authorityId,
      };
    }

    // 2. Check capability exclusion (deny-list overrides everything)
    if (ctx.identity.excludedCapabilities.includes(ctx.capability)) {
      return {
        authorized: false,
        requiresConfirmation: false,
        reason: `Capability '${ctx.capability}' is explicitly excluded from this delegation`,
        deniedBy: 'excluded_capability',
        identityId: ctx.identity.identityId,
        authorityId: ctx.identity.authority.authorityId,
      };
    }

    // 3. Check capability inclusion (if specified, must be included)
    if (ctx.identity.includedCapabilities.length > 0 &&
      !ctx.identity.includedCapabilities.includes(ctx.capability)) {
      return {
        authorized: false,
        requiresConfirmation: false,
        reason: `Capability '${ctx.capability}' is not in the included capabilities list`,
        deniedBy: 'excluded_capability',
        identityId: ctx.identity.identityId,
        authorityId: ctx.identity.authority.authorityId,
      };
    }

    // 4. Check resource boundaries
    const resourceResult = this.checkResourceBoundaries(ctx);
    if (!resourceResult.allowed) {
      return {
        authorized: false,
        requiresConfirmation: false,
        reason: resourceResult.reason,
        deniedBy: 'resource_boundary',
        identityId: ctx.identity.identityId,
        authorityId: ctx.identity.authority.authorityId,
      };
    }

    // 5. Check side effect policy
    const sideEffectResult = this.checkSideEffectPolicy(ctx);
    if (!sideEffectResult.allowed) {
      return {
        authorized: false,
        requiresConfirmation: false,
        reason: sideEffectResult.reason,
        deniedBy: 'side_effect_policy',
        identityId: ctx.identity.identityId,
        authorityId: ctx.identity.authority.authorityId,
      };
    }

    // 6. Check always-confirm list
    const alwaysConfirm = ctx.identity.alwaysConfirmActions.includes(ctx.capability);
    if (alwaysConfirm) {
      return {
        authorized: true,
        requiresConfirmation: true,
        reason: `Capability '${ctx.capability}' always requires human confirmation per delegation`,
        deniedBy: 'always_confirm',
        identityId: ctx.identity.identityId,
        authorityId: ctx.identity.authority.authorityId,
      };
    }

    // 7. Check side effect confirmation requirement
    if (sideEffectResult.requiresConfirmation) {
      return {
        authorized: true,
        requiresConfirmation: true,
        reason: sideEffectResult.reason,
        identityId: ctx.identity.identityId,
        authorityId: ctx.identity.authority.authorityId,
      };
    }

    // 8. All checks passed — authorized
    return {
      authorized: true,
      requiresConfirmation: false,
      reason: 'Authorized by delegated identity and authority',
      identityId: ctx.identity.identityId,
      authorityId: ctx.identity.authority.authorityId,
    };
  }

  /**
   * Check resource boundaries for a target.
   * Deny rules take precedence over allow rules.
   */
  private checkResourceBoundaries(ctx: AuthorityEvaluationContext): {
    allowed: boolean;
    reason: string;
  } {
    const boundaries = ctx.identity.resourceBoundaries.filter(
      (b) => b.resourceType === ctx.resourceType,
    );

    if (boundaries.length === 0) {
      // No boundaries for this resource type — allow (authority handles it)
      return { allowed: true, reason: 'No resource boundaries for this type' };
    }

    // Check deny rules first (deny takes precedence)
    for (const boundary of boundaries) {
      if (boundary.effect === 'deny' && this.matchResource(boundary, ctx.target)) {
        return {
          allowed: false,
          reason: `Resource '${ctx.target}' denied by boundary: ${boundary.reason}`,
        };
      }
    }

    // Check allow rules
    const hasAllowRules = boundaries.some((b) => b.effect === 'allow');
    if (hasAllowRules) {
      const matched = boundaries.some(
        (b) => b.effect === 'allow' && this.matchResource(b, ctx.target),
      );
      if (!matched) {
        return {
          allowed: false,
          reason: `Resource '${ctx.target}' not in any allow boundary for ${ctx.resourceType}`,
        };
      }
    }

    return { allowed: true, reason: 'Resource within boundaries' };
  }

  /**
   * Check side effect policy for the action.
   */
  private checkSideEffectPolicy(ctx: AuthorityEvaluationContext): {
    allowed: boolean;
    requiresConfirmation: boolean;
    reason: string;
  } {
    const policy = ctx.identity.sideEffectPolicies.find(
      (p) => p.category === ctx.sideEffectCategory,
    );

    if (!policy) {
      // No explicit policy — default to conservative
      if (ctx.sideEffectCategory === 'FINANCIAL' || ctx.sideEffectCategory === 'DELETE' ||
        ctx.sideEffectCategory === 'EXTERNAL_COMMITMENT' || ctx.sideEffectCategory === 'DEPLOY') {
        return {
          allowed: true,
          requiresConfirmation: true,
          reason: `Side effect category '${ctx.sideEffectCategory}' requires confirmation by default`,
        };
      }
      return { allowed: true, requiresConfirmation: false, reason: 'No explicit side effect policy' };
    }

    if (!policy.allowed) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `Side effect category '${ctx.sideEffectCategory}' is not allowed: ${policy.reason}`,
      };
    }

    // Check risk level
    const riskRank: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4, R5: 5 };
    if (riskRank[ctx.risk] > riskRank[policy.maxRiskLevel]) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `Risk ${ctx.risk} exceeds side effect policy limit ${policy.maxRiskLevel} for ${ctx.sideEffectCategory}`,
      };
    }

    return {
      allowed: true,
      requiresConfirmation: policy.requiresHumanConfirmation,
      reason: policy.requiresHumanConfirmation
        ? `Side effect category '${ctx.sideEffectCategory}' requires human confirmation`
        : `Side effect category '${ctx.sideEffectCategory}' allowed`,
    };
  }

  /**
   * Match a resource against a boundary pattern.
   * Paths are normalized to prevent traversal attacks.
   */
  private matchResource(boundary: ResourceBoundary, target: string): boolean {
    // Normalize filesystem paths to prevent traversal attacks
    const normalizedTarget = this.normalizePath(target);
    const normalizedPattern = this.normalizePath(boundary.pattern);

    switch (boundary.matchMode) {
      case 'exact':
        return normalizedTarget === normalizedPattern;
      case 'prefix':
        return normalizedTarget.startsWith(normalizedPattern);
      case 'regex':
        try {
          return new RegExp(boundary.pattern).test(normalizedTarget);
        } catch {
          return false;
        }
      case 'glob':
        return this.globMatch(normalizedPattern, normalizedTarget);
      default:
        return false;
    }
  }

  /**
   * Normalize a filesystem path to prevent traversal attacks.
   * Resolves .. and . components and converts backslashes to forward slashes.
   */
  private normalizePath(p: string): string {
    // Convert backslashes to forward slashes
    const normalized = p.replace(/\\/g, '/');
    // Resolve .. and . components
    const parts = normalized.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '..') {
        resolved.pop();
      } else if (part !== '.' && part !== '') {
        resolved.push(part);
      } else if (part === '' && resolved.length === 0) {
        // Leading slash — keep it
      }
    }
    // Reconstruct
    const isAbsolute = normalized.startsWith('/');
    const result = (isAbsolute ? '/' : '') + resolved.join('/');
    return result.toLowerCase();
  }

  /**
   * Simple glob matcher.
   * Handles both forward slash and backslash as path separators.
   */
  private globMatch(pattern: string, target: string): boolean {
    // Normalize both pattern and target to use forward slashes
    const normalizedPattern = pattern.replace(/\\/g, '/');
    const normalizedTarget = target.replace(/\\/g, '/');

    // First escape all regex special chars in the original pattern
    let escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    // Then replace glob patterns with regex equivalents
    // ** → .* (matches anything including path separators)
    escaped = escaped.replace(/\*\*/g, '{{GLOBSTAR}}');
    // * → [^/]* (matches anything except path separator)
    escaped = escaped.replace(/\*/g, '[^/]*');
    // ? → . (matches single char)
    escaped = escaped.replace(/\?/g, '.');
    // Restore globstar
    escaped = escaped.replace(/\{\{GLOBSTAR\}\}/g, '.*');
    try {
      return new RegExp(`^${escaped}$`, 'i').test(normalizedTarget);
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Default Side Effect Policies
// ---------------------------------------------------------------------------

/**
 * Default side effect policies — conservative.
 * Financial, delete, external commitment, and deploy always require
 * human confirmation.
 */
export function createDefaultSideEffectPolicies(): SideEffectPolicy[] {
  return [
    { category: 'READ', allowed: true, requiresHumanConfirmation: false, maxRiskLevel: 'R1', countsAsExternal: false, countsAsDestructive: false, reason: 'Read operations autonomous where authorized' },
    { category: 'CREATE', allowed: true, requiresHumanConfirmation: false, maxRiskLevel: 'R2', countsAsExternal: false, countsAsDestructive: false, reason: 'Create operations bounded autonomy' },
    { category: 'MODIFY', allowed: true, requiresHumanConfirmation: false, maxRiskLevel: 'R2', countsAsExternal: false, countsAsDestructive: false, reason: 'Modify operations resource-scoped' },
    { category: 'DELETE', allowed: true, requiresHumanConfirmation: true, maxRiskLevel: 'R3', countsAsExternal: false, countsAsDestructive: true, reason: 'Delete operations require human confirmation by default' },
    { category: 'COMMUNICATE', allowed: true, requiresHumanConfirmation: true, maxRiskLevel: 'R3', countsAsExternal: true, countsAsDestructive: false, reason: 'External communication requires confirmation unless explicitly delegated' },
    { category: 'AUTHENTICATE', allowed: true, requiresHumanConfirmation: false, maxRiskLevel: 'R2', countsAsExternal: false, countsAsDestructive: false, reason: 'Authentication always logged' },
    { category: 'FINANCIAL', allowed: true, requiresHumanConfirmation: true, maxRiskLevel: 'R5', countsAsExternal: true, countsAsDestructive: false, reason: 'Financial operations require human confirmation always' },
    { category: 'DEPLOY', allowed: true, requiresHumanConfirmation: true, maxRiskLevel: 'R4', countsAsExternal: true, countsAsDestructive: false, reason: 'Deployment requires policy-dependent confirmation' },
    { category: 'EXTERNAL_COMMITMENT', allowed: true, requiresHumanConfirmation: true, maxRiskLevel: 'R4', countsAsExternal: true, countsAsDestructive: false, reason: 'External commitments require human confirmation always' },
  ];
}

// ---------------------------------------------------------------------------
// Default Resource Boundaries
// ---------------------------------------------------------------------------

/**
 * Default resource boundaries — deny protected system paths,
 * allow workspace paths.
 */
export function createDefaultResourceBoundaries(workspaceRoot: string): ResourceBoundary[] {
  return [
    // Filesystem — deny protected paths
    { resourceType: 'filesystem_path', effect: 'deny', pattern: 'C:\\Windows', matchMode: 'prefix', reason: 'Windows system directory is protected' },
    { resourceType: 'filesystem_path', effect: 'deny', pattern: 'C:\\Program Files', matchMode: 'prefix', reason: 'Program Files is protected' },
    { resourceType: 'filesystem_path', effect: 'deny', pattern: '/etc', matchMode: 'prefix', reason: 'Unix system config is protected' },
    { resourceType: 'filesystem_path', effect: 'deny', pattern: '/usr', matchMode: 'prefix', reason: 'Unix system binaries are protected' },
    { resourceType: 'filesystem_path', effect: 'deny', pattern: '/root', matchMode: 'prefix', reason: 'Root home is protected' },
    { resourceType: 'filesystem_path', effect: 'deny', pattern: '**/.ssh/**', matchMode: 'glob', reason: 'SSH keys are protected' },
    { resourceType: 'filesystem_path', effect: 'deny', pattern: '**/.env', matchMode: 'glob', reason: 'Environment files may contain secrets' },
    { resourceType: 'filesystem_path', effect: 'deny', pattern: '**/.env.local', matchMode: 'glob', reason: 'Local environment files may contain secrets' },
    { resourceType: 'filesystem_path', effect: 'deny', pattern: '**/.env.production', matchMode: 'glob', reason: 'Production environment files may contain secrets' },
    // Filesystem — allow workspace
    { resourceType: 'filesystem_path', effect: 'allow', pattern: workspaceRoot, matchMode: 'prefix', reason: 'Workspace root is allowed' },
    { resourceType: 'filesystem_path', effect: 'allow', pattern: os.tmpdir(), matchMode: 'prefix', reason: 'Temp directory is allowed' },

    // Browser origins — deny known sensitive origins
    { resourceType: 'browser_origin', effect: 'deny', pattern: 'chrome://*', matchMode: 'glob', reason: 'Chrome internal pages are protected' },
    { resourceType: 'browser_origin', effect: 'deny', pattern: 'about:*', matchMode: 'glob', reason: 'Browser about pages are protected' },

    // Commands — deny dangerous commands
    { resourceType: 'command', effect: 'deny', pattern: 'rm -rf /*', matchMode: 'exact', reason: 'Recursive root delete is prohibited' },
    { resourceType: 'command', effect: 'deny', pattern: 'rm -rf /', matchMode: 'exact', reason: 'Root delete is prohibited' },
    { resourceType: 'command', effect: 'deny', pattern: 'format *', matchMode: 'glob', reason: 'Disk format is prohibited' },
    { resourceType: 'command', effect: 'deny', pattern: 'shutdown *', matchMode: 'glob', reason: 'System shutdown is prohibited' },
    { resourceType: 'command', effect: 'deny', pattern: 'del /f /s /q C:\\*', matchMode: 'exact', reason: 'Forced recursive delete is prohibited' },
  ];
}

// ---------------------------------------------------------------------------
// Side Effect Category Mapping
// ---------------------------------------------------------------------------

/**
 * Map a capability to its side effect category.
 */
export function capabilityToSideEffectCategory(capability: string): SideEffectCategory {
  // READ operations
  if (capability.includes('read') || capability.includes('inspect') ||
    capability.includes('discover') || capability.includes('validate') ||
    capability.includes('screenshot') || capability.includes('health_check') ||
    capability.includes('dns_lookup') || capability.includes('connectivity_test') ||
    capability.includes('git_status')) {
    return 'READ';
  }

  // DELETE operations
  if (capability.includes('delete') || capability.includes('revoke')) {
    return 'DELETE';
  }

  // FINANCIAL operations
  if (capability.includes('financial') || capability.includes('charge') ||
    capability.includes('subscription') || capability.includes('refund') ||
    capability.includes('payout')) {
    return 'FINANCIAL';
  }

  // COMMUNICATE operations
  if (capability.includes('send_email') || capability.includes('send_message')) {
    return 'COMMUNICATE';
  }

  // DEPLOY operations
  if (capability.includes('deploy') || capability.includes('git_push')) {
    return 'DEPLOY';
  }

  // AUTHENTICATE operations
  if (capability.includes('credential') && capability.includes('provision')) {
    return 'AUTHENTICATE';
  }
  if (capability.includes('credential') && capability.includes('rotate')) {
    return 'AUTHENTICATE';
  }

  // CREATE operations
  if (capability.includes('create') || capability.includes('write') ||
    capability.includes('start') || capability.includes('provision')) {
    return 'CREATE';
  }

  // MODIFY operations
  if (capability.includes('modify') || capability.includes('update') ||
    capability.includes('move') || capability.includes('type') ||
    capability.includes('click') || capability.includes('select') ||
    capability.includes('submit') || capability.includes('commit') ||
    capability.includes('branch') || capability.includes('build') ||
    capability.includes('restart') || capability.includes('navigate')) {
    return 'MODIFY';
  }

  // Default to MODIFY (conservative)
  return 'MODIFY';
}

/**
 * Map a capability to its resource boundary type.
 */
export function capabilityToResourceType(capability: string, target: string): ResourceBoundaryType {
  if (capability.startsWith('filesystem.')) return 'filesystem_path';
  if (capability.startsWith('browser.')) return 'browser_origin';
  if (capability.startsWith('network.')) return 'api_endpoint';
  if (capability.startsWith('dev.git')) return 'repository';
  if (capability.startsWith('dev.')) return 'command';
  if (capability.startsWith('process.')) return 'process';
  if (capability.startsWith('infra.')) return 'service';
  if (capability.startsWith('credential.')) return 'credential_ref';
  if (capability.startsWith('comm.')) return 'api_endpoint';
  // Infer from target
  if (target.startsWith('http://') || target.startsWith('https://')) return 'api_endpoint';
  if (target.match(/^[A-Z]:\\|^\//)) return 'filesystem_path';
  return 'filesystem_path';
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
