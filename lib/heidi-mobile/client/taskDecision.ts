/**
 * Shared POST /api/heidi-mobile/tasks decision path for Tasks tab and chat cards.
 */

import { heidiRequest, type ApiError, type ApiResult } from './api';

export type TaskDecision = 'approve' | 'reject';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ChatStreamAction {
  type: string | null;
  status: string | null;
  actionId: string | null;
  missionId: number | null;
  error: string | null;
}

export function isUuidActionId(id: string | null): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

export function isPositiveMissionId(id: number | null): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

/** pending_approval with an id the BFF can decide on. */
export function isChatActionDecidable(a: ChatStreamAction): boolean {
  if (a.status !== 'pending_approval') return false;
  return isUuidActionId(a.actionId) || isPositiveMissionId(a.missionId);
}

export function chatActionTitle(a: ChatStreamAction): string {
  return (a.type || 'action').replace(/_/g, ' ');
}

export function describeChatActionNote(a: ChatStreamAction): string | null {
  const name = a.type || 'action';
  if (a.status === 'pending_approval') {
    if (isChatActionDecidable(a)) return null;
    return `${name} — needs your approval (see Tasks)`;
  }
  if (a.status === 'failed') return `${name} — failed${a.error ? `: ${a.error}` : ''}`;
  return `${name} — ${a.status || 'unknown'}`;
}

export function actionCardKey(a: Pick<ChatStreamAction, 'actionId' | 'missionId' | 'type'>): string {
  if (isPositiveMissionId(a.missionId)) return `m:${a.missionId}`;
  if (isUuidActionId(a.actionId)) return a.actionId;
  return `anon:${a.type || 'action'}`;
}

export function buildTaskDecisionBody(
  target: { actionId?: string | null; missionId?: number | null },
  decision: TaskDecision,
): { id: string; decision: TaskDecision } | { mission_id: number; decision: TaskDecision } | null {
  if (isPositiveMissionId(target.missionId ?? null)) {
    return { mission_id: target.missionId as number, decision };
  }
  if (isUuidActionId(target.actionId ?? null)) {
    return { id: target.actionId as string, decision };
  }
  return null;
}

export interface TaskDecisionResponse {
  ok: boolean;
  status: string | null;
  error: string | null;
  decision?: string;
}

export async function postTaskDecision(
  target: { actionId?: string | null; missionId?: number | null },
  decision: TaskDecision,
  opts: { timeoutMs?: number } = {},
): Promise<ApiResult<TaskDecisionResponse>> {
  const body = buildTaskDecisionBody(target, decision);
  if (!body) {
    return { ok: false, error: { kind: 'client', message: 'Nothing to decide — open Tasks.' } };
  }
  return heidiRequest<TaskDecisionResponse>('/tasks', {
    method: 'POST',
    body,
    timeoutMs: opts.timeoutMs ?? 40_000,
  });
}

export function formatTaskDecisionOutcome(
  decision: TaskDecision,
  result: ApiResult<TaskDecisionResponse>,
  opts: { viaMission: boolean },
): { ok: boolean; text: string; authError?: ApiError } {
  if (result.ok) {
    const executedFailed = decision === 'approve' && result.data.status === 'failed';
    const text = decision === 'reject'
      ? 'Rejected — it will not run.'
      : executedFailed
        ? `Approved, but the action failed: ${result.data.error || 'no detail from HYDI'}`
        : opts.viaMission
          ? 'Decision recorded — Heidi will run it if the safety gates pass.'
          : 'Approved and executed.';
    return { ok: !executedFailed, text };
  }
  const text = result.error.status === 409
    ? (result.error.message || 'HYDI refused this decision.')
    : `Not ${decision === 'approve' ? 'approved' : 'rejected'}: ${result.error.message}`;
  const authError = ['not_paired', 'unauthorized'].includes(result.error.kind) ? result.error : undefined;
  return { ok: false, text, authError };
}

export type ApprovalCardPhase = 'idle' | 'confirm' | 'sending' | 'settled';

export interface ApprovalCardController {
  phase: ApprovalCardPhase;
  pendingDecision: TaskDecision | null;
  tap(decision: TaskDecision): void;
  cancelConfirm(): void;
  confirm(): Promise<{ ok: boolean; text: string; authError?: ApiError }>;
}

/** First tap opens confirm only; POST runs on confirm(). */
export function createApprovalCardController(
  online: boolean,
  target: { actionId: string | null; missionId: number | null },
): ApprovalCardController {
  let phase: ApprovalCardPhase = 'idle';
  let pendingDecision: TaskDecision | null = null;

  return {
    get phase() { return phase; },
    get pendingDecision() { return pendingDecision; },
    tap(decision: TaskDecision) {
      if (!online || phase === 'sending' || phase === 'settled') return;
      pendingDecision = decision;
      phase = 'confirm';
    },
    cancelConfirm() {
      if (phase !== 'confirm' || pendingDecision === null) return;
      pendingDecision = null;
      phase = 'idle';
    },
    async confirm() {
      if (phase !== 'confirm' || pendingDecision === null) {
        return { ok: false, text: 'No decision pending.' };
      }
      const decision = pendingDecision;
      phase = 'sending';
      const result = await postTaskDecision(target, decision);
      phase = 'settled';
      const formatted = formatTaskDecisionOutcome(decision, result, {
        viaMission: isPositiveMissionId(target.missionId),
      });
      pendingDecision = null;
      return formatted;
    },
  };
}