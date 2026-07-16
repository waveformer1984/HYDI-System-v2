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
import { ActionExecutor } from './action-executor';
import { createDefaultAgentRegistry } from './agents/registry';

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
  return createClient(url, key);
}

async function backfillDecisionOutcome(decisionId: string | undefined, outcome: 'success' | 'failure', detail: Record<string, unknown>) {
  if (!decisionId) return;
  try {
    const { recordOutcome } = (await import('./protoforge/policy-engine.js')) as unknown as {
      recordOutcome: (id: string, outcome: string, detail?: Record<string, unknown>) => Promise<void>;
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

  const executor = new ActionExecutor(supabase);
  const registry = createDefaultAgentRegistry(executor);
  const agent = registry.getAgentFor(actionType);
  const outcome = agent
    ? await agent.execute({ type: actionType, payload: actionPayload }, row.session_id)
    : await executor.execute({ type: actionType, payload: actionPayload }, row.session_id);

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
