/**
 * ACTION APPROVAL — resolves a chat-originated action that ProtoForge
 * escalated for human review (see lib/orchestrator.ts's executeActions).
 *
 * An escalated action is parked as an `actions` row with status='pending'
 * and payload.protoforge_pending_approval=true, carrying everything needed
 * to run it later: action type, action payload, and the ProtoForge
 * decisionId to backfill once resolved. This module is the only place that
 * resolves those rows — it never re-runs KILO/ProtoForge gating, because
 * the human's approve/reject decision *is* the gate's terminal answer.
 */

import { createClient } from '@supabase/supabase-js';
import { createTimedClient } from './supabase-timed';
import { createHash } from 'crypto';
import { ActionExecutor } from './action-executor';
import { createDefaultAgentRegistry } from './agents/registry';
import { signAuthorization, payloadDigest, canonicalJson } from './governance/approval-signing';

export interface ResolveActionResult {
  ok: boolean;
  status?: 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  }
  return createTimedClient(url, key);
}

async function backfillDecisionOutcome(decisionId: string | undefined, outcome: 'success' | 'failure', detail: Record<string, unknown>) {
  if (!decisionId) return;
  try {
    const { recordOutcome } = (await import('./protoforge/policy-engine.js')) as unknown as {
      recordOutcome: (_id: string, _outcome: string, _detail?: Record<string, unknown>) => Promise<void>;
    };
    await recordOutcome(decisionId, outcome, detail);
  } catch (error) {
    console.error('[ActionApproval] Failed to record ProtoForge outcome:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Approve or reject a pending escalated action. Guards against resolving
 * anything that isn't actually an escalation awaiting approval — e.g. an
 * ordinary 'pending' create_task/schedule_event bookkeeping row, or an
 * already-resolved action.
 */
export async function resolvePendingAction(actionId: string, resolution: 'approve' | 'reject'): Promise<ResolveActionResult> {
  const supabase = getSupabase();

  const { data: row, error: fetchError } = await supabase.from('actions').select('*').eq('id', actionId).single();
  if (fetchError || !row) {
    return { ok: false, error: 'Action not found' };
  }

  const payload = (row.payload as Record<string, unknown>) || {};
  if (row.status !== 'pending' || payload.protoforge_pending_approval !== true) {
    return { ok: false, error: 'Action is not awaiting approval' };
  }

  const decisionId = payload.protoforge_decision_id as string | undefined;

  // Forged-escalation guard (red-team 2026-09-18): `protoforge_pending_approval`
  // is just a boolean in a row payload — anyone who can write an `actions` row
  // can set it. The marker alone proved nothing; a planted pending row would be
  // resolved and mint authorization out of thin air. A genuine escalation is
  // produced by gateActions(), which records a real `decisions` row and stores
  // its id here. Require the decision to actually exist — and to be an
  // 'escalate' verdict — before any authorization is minted.
  if (!decisionId) {
    return { ok: false, error: 'Escalated action has no ProtoForge decision reference — refusing to resolve a possibly forged approval request' };
  }
  const { data: decisionRow, error: decisionError } = await supabase
    .from('decisions')
    .select('id, decision, hypothesis_id, outcome')
    .eq('id', decisionId)
    .maybeSingle();
  if (decisionError || !decisionRow) {
    return { ok: false, error: 'Escalated action references a ProtoForge decision that does not exist — refusing forged approval' };
  }
  const dRow = decisionRow as { decision?: string; hypothesis_id?: string; outcome?: string | null };
  if (dRow.decision !== 'escalate') {
    return { ok: false, error: `Referenced ProtoForge decision is '${dRow.decision}', not 'escalate' — refusing` };
  }

  // Decision-reuse guard: a resolved decision has its outcome backfilled.
  // Reusing one decisionId across N parked rows would let a single 'escalate'
  // verdict authorize many actions — refuse if it was already consumed.
  if (dRow.outcome != null) {
    return { ok: false, error: 'Referenced ProtoForge decision was already resolved — refusing to replay a consumed approval' };
  }

  // Decision->action binding (red-team 2026-09-18): 'escalate' alone proved
  // only that SOME escalation exists. The hypothesis fingerprint recorded as
  // decisions.hypothesis_id is sha256(session:planIndex:type:canonicalJson(
  // payload)) — recomputing it from THIS row's stored action proves the
  // decision was genuinely produced for this exact action in this session.
  // A planted row (e.g. via autonomous create_task) either references a
  // decision made for a different action (fingerprint mismatch -> refuse) or
  // fabricates one (no row -> refused above).
  const storedHypothesisId = payload.protoforge_hypothesis_id as string | undefined;
  const planIndex = payload.protoforge_plan_index as number | undefined;
  const pendingType = payload.protoforge_action_type as string | undefined;
  const pendingPayload = (payload.protoforge_action_payload as Record<string, unknown>) || {};
  if (typeof storedHypothesisId !== 'string' || typeof planIndex !== 'number' || typeof pendingType !== 'string') {
    return { ok: false, error: 'Escalated action is missing its decision-binding fields — refusing a possibly forged approval request' };
  }
  const recomputed = createHash('sha256')
    .update(`${row.session_id}:${planIndex}:${pendingType}:${canonicalJson(pendingPayload)}`)
    .digest('hex');
  if (recomputed !== storedHypothesisId || recomputed !== dRow.hypothesis_id) {
    return { ok: false, error: 'Referenced ProtoForge decision was not produced for this action — refusing a mismatched approval request' };
  }

  if (resolution === 'reject') {
    const { error } = await supabase
      .from('actions')
      .update({
        status: 'failed',
        payload: { ...payload, resolution: 'rejected_by_user', resolved_at: new Date().toISOString() },
      })
      .eq('id', actionId);
    if (error) return { ok: false, error: error.message };
    await backfillDecisionOutcome(decisionId, 'failure', { rejected_by_user: true });
    return { ok: true, status: 'failed' };
  }

  const actionType = payload.protoforge_action_type as string;
  const actionPayload = (payload.protoforge_action_payload as Record<string, unknown>) || {};

  // This IS the human authorization. The action was parked as pending, a real
  // ProtoForge 'escalate' decision row exists for it (verified above), and a
  // person resolved it 'approve'. The signature binds the record to THIS
  // action type + session + payload so the chokepoint can verify provenance
  // and it cannot be replayed onto a different action. If signing is
  // impossible (no key configured) the authorization cannot be made
  // verifiable, so we refuse rather than mint an unverifiable one.
  const authBase = {
    approvedBy: 'user:owner',
    approvalRef: actionId,
    grantedAt: new Date().toISOString(),
  };
  // The signature binds (approvedBy | approvalRef | grantedAt | actionType |
  // sessionId | payloadDigest) — the same tuple the chokepoint recomputes from
  // the request it receives. An approval for a different action, session, or
  // payload would digest differently and be refused there.
  const signature = signAuthorization(authBase, actionType, row.session_id, payloadDigest(actionPayload));
  if (!signature) {
    return { ok: false, error: 'Cannot mint a verifiable authorization — no approval signing key configured (HYDI_APPROVAL_SECRET / SUPABASE_SERVICE_ROLE_KEY)' };
  }
  const authorization = { ...authBase, signature };

  const executor = new ActionExecutor(supabase);
  const registry = createDefaultAgentRegistry(executor);
  const agent = registry.getAgentFor(actionType);
  const outcome = agent
    ? await agent.execute({ type: actionType, payload: actionPayload }, row.session_id, authorization)
    : await executor.execute({ type: actionType, payload: actionPayload }, row.session_id, authorization);

  const { error: updateError } = await supabase
    .from('actions')
    .update({
      status: outcome.status,
      payload: {
        ...payload,
        result: outcome.result,
        error: outcome.error,
        resolution: 'approved_by_user',
        resolved_at: new Date().toISOString(),
      },
    })
    .eq('id', actionId);
  if (updateError) return { ok: false, error: updateError.message };

  await backfillDecisionOutcome(decisionId, outcome.status === 'completed' ? 'success' : 'failure', { error: outcome.error });

  return { ok: true, status: outcome.status, result: outcome.result, error: outcome.error };
}
