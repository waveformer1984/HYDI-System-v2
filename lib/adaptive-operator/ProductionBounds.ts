/**
 * Production Autonomy Bounds for AdaptiveOperator
 *
 * Pulls limits from existing HYDI governance config rather than inventing
 * new values. Sources:
 *
 *   - AutonomyContract (lib/operational/AutonomyContract.ts):
 *       HEIDI_MAY caps autonomous recovery at R1; R2 requires
 *       policy_authorized. R3+ (HIGH/CRITICAL) is never autonomous.
 *       Financial actions are explicitly prohibited autonomously.
 *       Destructive DB operations are explicitly prohibited.
 *
 *   - SelfRepairEngine flapping guard (CognitiveCoreBuilder.ts:383):
 *       3 repairs within 10 cycles → stop + escalate. Maps to maxRetries=3.
 *
 *   - HeidiOrchestrator.runWorkSession maxSteps default (orchestrator.ts:1298):
 *       5 steps per call. Maps to maxActionsPerPlan=20 (4x the per-call
 *       limit, since AdaptiveOperator runs in a single invocation rather
 *       than per-call).
 *
 *   - maxReplans=3: matches the flapping threshold. More than 3 replans
 *       on the same goal indicates the plan is fundamentally wrong, not
 *       adaptively recoverable.
 *
 * All values are overridable via env vars for per-environment tuning.
 * maxFinancialExposure is ALWAYS 0 in production — financial actions
 * are prohibited by AutonomyContract and cannot be enabled via env.
 */

import type { AutonomyBounds } from './AdaptiveOperatorTypes';

function parseInt32(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

/**
 * Build production autonomy bounds from env vars + existing config defaults.
 * Financial exposure is hardcoded to 0 — it is NOT env-overridable.
 */
export function getProductionAutonomyBounds(): AutonomyBounds {
  return {
    // 4x the orchestrator's per-call maxSteps (5) — AdaptiveOperator
    // runs a full goal in one invocation, not step-by-step per call.
    maxActionsPerPlan: parseInt32(process.env.ADAPTIVE_OPERATOR_MAX_ACTIONS, 20),

    // Matches SelfRepairEngine flapping threshold (3). More than 3
    // replans = the plan is fundamentally wrong, not recoverable.
    maxReplans: parseInt32(process.env.ADAPTIVE_OPERATOR_MAX_REPLANS, 3),

    // Matches SelfRepairEngine flapping threshold (3 repairs).
    maxRetries: parseInt32(process.env.ADAPTIVE_OPERATOR_MAX_RETRIES, 3),

    // 10 minutes — tighter than the 30-min qualification default.
    // Production goals should converge or escalate, not run indefinitely.
    maxExecutionTimeMs: parseInt32(process.env.ADAPTIVE_OPERATOR_MAX_TIME_MS, 10 * 60 * 1000),

    // R2 = MEDIUM = policy_authorized. R3+ (HIGH/CRITICAL) requires
    // human per AutonomyContract. Autonomous goals must not exceed R2.
    maxRisk: (process.env.ADAPTIVE_OPERATOR_MAX_RISK as AutonomyBounds['maxRisk']) || 'R2',

    // External side effects (emails sent, API calls to third parties).
    // Conservative: 3 per goal.
    maxExternalSideEffects: parseInt32(process.env.ADAPTIVE_OPERATOR_MAX_SIDE_EFFECTS, 3),

    // Destructive actions — AutonomyContract prohibits destructive DB
    // operations autonomously. Filesystem deletes are R3 (HIGH) which
    // already exceeds maxRisk=R2. So this should always be 0 in practice,
    // but we keep it as a hard backstop.
    maxDestructiveActions: 0,

    // Authorization requests before escalation.
    maxAuthorizationRequests: parseInt32(process.env.ADAPTIVE_OPERATOR_MAX_AUTH_REQUESTS, 3),

    // ALWAYS 0 — financial actions are prohibited by AutonomyContract.
    // This is NOT overridable via env.
    maxFinancialExposure: 0,
  };
}

/**
 * Check whether the AdaptiveOperator feature flag is enabled.
 * Default: false in production, true in test.
 */
export function isAdaptiveOperatorEnabled(): boolean {
  const raw = process.env.ADAPTIVE_OPERATOR_ENABLED;
  if (raw === undefined) {
    // Default off in production, on in test
    return process.env.NODE_ENV === 'test';
  }
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/**
 * Goal category allowlist for staged rollout.
 *
 * When ADAPTIVE_OPERATOR_GOAL_ALLOWLIST is set (comma-separated), only
 * goals matching the allowed categories are delegated to AdaptiveOperator.
 * Goals outside the allowlist fall back to the legacy path.
 *
 * Categories:
 *   - infra: CODE_HEALTHY, SERVICES_RUNNING, ENDPOINT_VERIFIED, CREDENTIALS_READY
 *   - revenue: REVENUE_LEDGER_VERIFIED, PAYOUTS_RECONCILED
 *   - connect: CONNECT_ACCOUNT_VERIFIED
 *   - browser: BROWSER_NAVIGATED
 *   - file: FILE_MODIFIED, FILE_DELETED, DIRECTORY_EXISTS
 *
 * When unset, all categories are allowed (Stage 3+).
 */
export type GoalCategory = 'infra' | 'revenue' | 'connect' | 'browser' | 'file';

const GOAL_KEYWORDS: Record<GoalCategory, string[]> = {
  infra: ['health', 'service', 'port', 'endpoint', 'code', 'credential', 'config', 'diagnose', 'check', 'inspect', 'fix', 'repair', 'recover'],
  revenue: ['reconcile', 'payout', 'ledger', 'revenue', 'earnings', 'income'],
  connect: ['connect account', 'connected account', 'onboard'],
  browser: ['navigate', 'browser', 'page'],
  file: ['create', 'delete', 'remove', 'modify', 'write', 'update', 'change', 'project', 'directory'],
};

export function getGoalAllowlist(): GoalCategory[] | null {
  const raw = process.env.ADAPTIVE_OPERATOR_GOAL_ALLOWLIST;
  if (!raw) return null; // unset = all allowed
  const categories = raw.split(',').map((s) => s.trim().toLowerCase()) as GoalCategory[];
  return categories.filter((c) => GOAL_KEYWORDS[c]);
}

/**
 * Check if a goal statement is allowed by the allowlist.
 * Returns true if the goal matches at least one allowed category.
 * If no allowlist is set, returns true (all goals allowed).
 */
export function isGoalAllowed(goalStatement: string): boolean {
  const allowlist = getGoalAllowlist();
  if (!allowlist) return true; // no allowlist = all allowed

  const lower = goalStatement.toLowerCase();
  for (const category of allowlist) {
    const keywords = GOAL_KEYWORDS[category];
    if (keywords.some((kw) => lower.includes(kw))) {
      return true;
    }
  }
  return false;
}
