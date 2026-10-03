/**
 * Operations Console — deterministic proposal → UI-state mapping and
 * API-error classification. Pure logic, no I/O: the workspace page and
 * its tests share these functions so the UI can never drift from the
 * durable proposal/mission contract.
 *
 * Honesty contract:
 *   APPROVED ≠ AUTHORIZED ≠ EXECUTED ≠ PROVEN ≠ REVENUE.
 *   Proposal rows can only ever display states backed by
 *   heidi_action_proposals.status + the joined heidi_missions row.
 *   'AUTHORIZED', 'PROVEN' and 'REVENUE' are deliberately NOT producible
 *   here — they belong to authorization/proof evidence the proposal
 *   surface does not carry.
 */

export type ProposalStatus =
  | 'pending' | 'approved' | 'rejected' | 'expired' | 'retracted';

export type MissionStatusName =
  | 'planned' | 'claimed' | 'running' | 'verifying'
  | 'waiting_human' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

export interface ProposalLike {
  status: string;
  expiresAt?: string | null;
  /** Set only when the daemon's authorization gate consumed the approval
   *  (heidi_action_proposals.authorization_consumed_at). This is the ONLY
   *  way 'AUTHORIZED' can appear — it is never inferred from approval. */
  authorizedAt?: string | null;
  missionId?: string | null;
  missionStatus?: string | null;
  missionStage?: string | null;
}

export type UiActionState =
  | 'AWAITING_APPROVAL'
  | 'APPROVED_QUEUED'
  | 'AUTHORIZED'
  | 'EXECUTING'
  | 'WAITING_HUMAN'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'RETRACTED'
  | 'UNPROVEN';

export interface UiAction {
  state: UiActionState;
  label: string;
  /** short honest qualifier shown next to the label */
  note: string;
  /** can the operator still approve/reject this row? */
  resolvable: boolean;
}

export function proposalUiState(p: ProposalLike, nowMs: number = Date.now()): UiAction {
  const status = p.status as ProposalStatus;

  if (status === 'pending') {
    const expired = p.expiresAt ? new Date(p.expiresAt).getTime() <= nowMs : false;
    return expired
      ? { state: 'EXPIRED', label: 'EXPIRED', note: 'approval window lapsed — non-executing', resolvable: false }
      : { state: 'AWAITING_APPROVAL', label: 'AWAITING HUMAN APPROVAL', note: 'consume-once decision required', resolvable: true };
  }
  if (status === 'rejected') {
    return { state: 'REJECTED', label: 'REJECTED', note: 'declined by operator — never executes', resolvable: false };
  }
  if (status === 'expired') {
    return { state: 'EXPIRED', label: 'EXPIRED', note: 'approval window lapsed — non-executing', resolvable: false };
  }
  if (status === 'retracted') {
    return { state: 'RETRACTED', label: 'RETRACTED', note: 'withdrawn by producer — never executes', resolvable: false };
  }
  if (status !== 'approved') {
    return { state: 'UNPROVEN', label: 'UNPROVEN', note: `unrecognized proposal status '${p.status}'`, resolvable: false };
  }

  // approved — the proposal minted a governed goal. What happened next is
  // evidence from the durable consume marker + mission row, never assumed.
  if (!p.missionId) {
    return p.authorizedAt
      ? {
        state: 'AUTHORIZED',
        label: 'AUTHORIZED',
        note: 'approval consumed by the authorization gate — bound action authorized once; execution is a separate step',
        resolvable: false,
      }
      : {
        state: 'APPROVED_QUEUED',
        label: 'APPROVED — GOAL QUEUED',
        note: 'durable approval recorded; authorization + execution still governed (R2 gate may hold it pending)',
        resolvable: false,
      };
  }
  const ms = p.missionStatus as MissionStatusName | null;
  switch (ms) {
    case 'planned':
      return { state: 'APPROVED_QUEUED', label: 'APPROVED — QUEUED', note: 'mission planned — awaiting dispatch', resolvable: false };
    case 'claimed':
    case 'running':
    case 'verifying':
      return { state: 'EXECUTING', label: 'EXECUTING', note: `mission ${ms}${p.missionStage ? ` · ${p.missionStage}` : ''}`, resolvable: false };
    case 'waiting_human':
      return { state: 'WAITING_HUMAN', label: 'WAITING ON HUMAN', note: 'execution paused — human input required', resolvable: false };
    case 'succeeded':
      return { state: 'COMPLETED', label: 'COMPLETED', note: 'mission verified succeeded — execution evidence, not proof of business outcome', resolvable: false };
    case 'failed':
      return { state: 'FAILED', label: 'FAILED', note: `mission failed${p.missionStage ? ` · ${p.missionStage}` : ''}`, resolvable: false };
    case 'timed_out':
      return { state: 'FAILED', label: 'FAILED', note: 'mission timed out — lease expired', resolvable: false };
    case 'cancelled':
      return { state: 'CANCELLED', label: 'CANCELLED', note: 'mission cancelled', resolvable: false };
    default:
      return { state: 'UNPROVEN', label: 'UNPROVEN', note: `approved; mission status '${ms ?? 'none'}' not recognized`, resolvable: false };
  }
}

/* ─── API error classification ─────────────────────────────────────── */

export type UiErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'ACTION_NOT_FOUND'
  | 'INVALID_PROPOSAL'
  | 'ALREADY_RESOLVED'
  | 'PROPOSAL_EXPIRED'
  | 'REFUSED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR';

export interface UiError {
  code: UiErrorCode;
  message: string;
}

/** Classify an HTTP failure from the proposals API into an honest UI
 *  state. `bodyError` is the server's `error` field when present. */
export function classifyApiError(httpStatus: number | null, bodyError?: string | null): UiError {
  const msg = bodyError ?? '';
  if (httpStatus === null) {
    return { code: 'NETWORK_ERROR', message: 'request failed — no response from server' };
  }
  if (httpStatus === 401) return { code: 'AUTH_REQUIRED', message: msg || 'authentication required' };
  if (httpStatus === 403) return { code: 'FORBIDDEN', message: msg || 'insufficient permission' };
  if (httpStatus === 404 || /not found/i.test(msg)) {
    return { code: 'ACTION_NOT_FOUND', message: msg || 'proposal not found' };
  }
  if (/expired/i.test(msg)) return { code: 'PROPOSAL_EXPIRED', message: msg };
  if (/consume-once|already|lost the race/i.test(msg)) return { code: 'ALREADY_RESOLVED', message: msg };
  if (/changed|fresh approval/i.test(msg)) return { code: 'REFUSED', message: msg };
  if (/invalid|must include|forbidden|allowlist/i.test(msg)) return { code: 'INVALID_PROPOSAL', message: msg };
  if (httpStatus >= 500) return { code: 'SERVER_ERROR', message: msg || 'server error' };
  if (httpStatus >= 400) return { code: 'INVALID_PROPOSAL', message: msg || `request refused (${httpStatus})` };
  return { code: 'SERVER_ERROR', message: msg || `unexpected status ${httpStatus}` };
}
