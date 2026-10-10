/**
 * Action chokepoint (Phase 3).
 * ---------------------------------------------------------------------------
 * The gap this closes, measured 2026-09-18:
 *
 *   Five independent action execution paths existed with no shared governance
 *   boundary. lib/action-executor.ts dispatched six action types -- including
 *   `send_email`, which POSTs to api.resend.com and sends REAL outbound mail --
 *   with no risk classification and no authorization. Its only guard was
 *   whether RESEND_API_KEY happened to be configured.
 *
 * Why lib/action-executor.ts is the right place to enforce:
 *   It is where Paths D and E converge.
 *     - lib/agents/base-agent.ts:51  routes every agent action through it
 *     - lib/orchestrator.ts          uses it as the fallback executor
 *     - lib/action-approval.ts:82    executes human-approved actions through it
 *   One guard covers all three. Path A (RecoveryEngine) is already governed and
 *   fail-closed; Path B (HumanActionEngine) has its own R0-R5 stack plus the
 *   Phase 4 filesystem authorization; Path C (heidi-core) is a separate class
 *   with its own allowlists. Those are NOT covered here, and this file does not
 *   pretend otherwise.
 *
 * Reuse, not reinvention:
 *   The risk -> authorization-mode policy is the shared part and is taken from
 *   lib/operational/RiskClassifier. Only the capability -> risk map is local,
 *   because agent action types are a different domain from operational recovery
 *   capabilities and conflating the two unions would make both less legible.
 */

import { randomUUID } from 'crypto';
import { riskClassifier } from '../operational/RiskClassifier';
import { verifyAuthorizationSignature, payloadDigest } from './approval-signing';
import type { RiskLevel } from '../operational/types';

export interface ActionAuthorization {
  /** Who approved it. An approval with no approver is not an approval. */
  approvedBy: string;
  /** What record proves it -- e.g. the `actions` row id the human resolved. */
  approvalRef: string;
  grantedAt: string;
  /**
   * HMAC proof that this record was minted by the verified-approval path
   * (lib/action-approval.ts) and bound to this action type + target. A
   * fabricated record has no valid signature. See approval-signing.ts.
   */
  signature?: string;
}

export interface ActionGateRequest {
  type: string;
  requester: string;
  reason?: string;
  target?: string;
  /**
   * The session the action runs in, and the action's payload. Both are bound
   * into the authorization signature so an approval cannot be replayed across
   * a session or onto a different payload. The chokepoint computes the
   * payload digest itself from `parameters` — it never trusts a
   * caller-supplied digest, because a mismatched caller digest would verify
   * a signature against a payload other than the one actually executed.
   */
  sessionId?: string;
  parameters?: Record<string, unknown>;
  authorization?: ActionAuthorization;
}

export type GateCode =
  | 'ALLOWED'
  | 'ALLOWED_WITH_AUTHORIZATION'
  | 'AUTHORIZATION_REQUIRED'
  | 'INVALID_AUTHORIZATION'
  | 'PROHIBITED'
  | 'UNKNOWN_ACTION';

export interface ActionGateDecision {
  actionId: string;
  allowed: boolean;
  code: GateCode;
  risk: RiskLevel;
  requiresAuthorization: boolean;
  requester: string;
  type: string;
  target?: string;
  reason: string;
  timestamp: string;
}

/**
 * Risk per action type dispatched by lib/action-executor.ts.
 *
 * send_email is R3 because it is irreversible and externally visible: once a
 * message leaves, no rollback exists. That is the case this gate exists for.
 *
 * KNOWN DIVERGENCE, recorded rather than silently resolved:
 *   lib/heidi/CapabilityRegistry.ts classifies `tool.send_email` as R2
 *   (autonomyRequirement 3, reversible: false). This file says R3. Both sit
 *   ABOVE the autonomous threshold, so the enforcement outcome is identical --
 *   authorization is required either way -- but they disagree on which KIND
 *   (policy_authorized vs human_required).
 *
 *   That two risk models exist at all is a symptom of the same fragmentation
 *   Phase 3 is closing, and it is not resolved here: picking a winner blind
 *   would change behaviour in a subsystem this change does not otherwise
 *   touch. scripts/capability-contract-gap-map.ts is the existing
 *   capability-drift detector and is the right tool to reconcile them.
 *
 * update_database is R1, NOT R2, and the distinction is load-bearing:
 * lib/action-executor.ts's own WRITABLE_TABLES allowlist narrows it to
 * `sessions` alone -- application conversation state, which is bounded and
 * reversible. R2 would demand a human approval for every ordinary session
 * update and freeze normal operation, which is the failure mode where a
 * governance control gets disabled wholesale because it is unusable.
 *
 * THIS CLASSIFICATION IS COUPLED TO THAT ALLOWLIST. If WRITABLE_TABLES ever
 * grows beyond `sessions` -- to a ledger, policy or credential table -- R1
 * stops being defensible. tests/unit/action-chokepoint.test.ts asserts the
 * allowlist's contents so that widening it fails a test rather than silently
 * widening autonomous authority.
 */
export const ACTION_RISK: Record<string, RiskLevel> = {
  fetch_data: 'R0',
  create_task: 'R1',
  schedule_event: 'R1',
  cancel_task: 'R1',
  update_database: 'R1',
  send_email: 'R3',
};

/**
 * An authorization is valid only if it is BOTH well-formed AND carries a
 * signature the verified-approval path minted for this exact action — bound
 * to its type, its session, and its payload digest. The signature check is
 * what stops the self-signed forgery: three non-empty strings are no longer
 * enough, and an approval minted for a different session or payload cannot be
 * replayed here.
 */
function isValidAuthorization(
  auth: unknown,
  type: string,
  sessionId: string | undefined,
  digest: string,
): auth is ActionAuthorization {
  if (!auth || typeof auth !== 'object') return false;
  const a = auth as Partial<ActionAuthorization>;
  if (
    typeof a.approvedBy !== 'string' || a.approvedBy.length === 0 ||
    typeof a.approvalRef !== 'string' || a.approvalRef.length === 0 ||
    typeof a.grantedAt !== 'string' || a.grantedAt.length === 0
  ) {
    return false;
  }
  // Verify the cryptographic binding. Cast is safe: the three string fields
  // were just confirmed present above.
  return verifyAuthorizationSignature(a as ActionAuthorization, type, sessionId, digest);
}

/**
 * Decide whether an action may execute. Never throws; always returns a
 * decision that can be recorded verbatim.
 */
export function evaluateAction(request: ActionGateRequest): ActionGateDecision {
  const base = {
    actionId: randomUUID(),
    requester: request.requester,
    type: request.type,
    target: request.target,
    timestamp: new Date().toISOString(),
  };

  // Unknown action types are R5. An action nobody classified is not a safe
  // action -- it is an unmodelled one, which is strictly worse.
  const known = Object.prototype.hasOwnProperty.call(ACTION_RISK, request.type);
  const risk: RiskLevel = known ? ACTION_RISK[request.type] : 'R5';
  const mode = riskClassifier.getAuthorizationMode(risk);

  if (mode === 'prohibited') {
    return {
      ...base,
      allowed: false,
      code: known ? 'PROHIBITED' : 'UNKNOWN_ACTION',
      risk,
      requiresAuthorization: false,
      reason: known
        ? `Action '${request.type}' is classified ${risk} (prohibited). No authorization can permit it.`
        : `Action '${request.type}' is not in the action risk map, so it is treated as ${risk} (prohibited). ` +
        `Classify it explicitly before it can execute — an unmodelled action is not a safe action.`,
    };
  }

  if (mode === 'autonomous') {
    return {
      ...base,
      allowed: true,
      code: 'ALLOWED',
      risk,
      requiresAuthorization: false,
      reason: `Action '${request.type}' is ${risk}, which executes autonomously.`,
    };
  }

  // policy_authorized | human_required -- both need producible evidence.
  if (request.authorization === undefined) {
    return {
      ...base,
      allowed: false,
      code: 'AUTHORIZATION_REQUIRED',
      risk,
      requiresAuthorization: true,
      reason:
        `Action '${request.type}' is ${risk} (${mode}) and was requested with no authorization. ` +
        `It requires an approval record before it can execute.`,
    };
  }

  // The authorization must be bound to THIS action's identity: its type, the
  // session it runs in, and the digest of the payload it carries. An approval
  // minted for anything else fails the digest check.
  const digest = payloadDigest(request.parameters);
  if (!isValidAuthorization(request.authorization, request.type, request.sessionId, digest)) {
    return {
      ...base,
      allowed: false,
      code: 'INVALID_AUTHORIZATION',
      risk,
      requiresAuthorization: true,
      reason:
        `Action '${request.type}' is ${risk} and carried an authorization that is not a verified approval record. ` +
        `It needs a signature minted by the approval path for this exact action — a self-attested record does not qualify.`,
    };
  }

  return {
    ...base,
    allowed: true,
    code: 'ALLOWED_WITH_AUTHORIZATION',
    risk,
    requiresAuthorization: true,
    reason:
      `Action '${request.type}' is ${risk} and was authorized by ${request.authorization.approvedBy} ` +
      `(ref ${request.authorization.approvalRef}).`,
  };
}
