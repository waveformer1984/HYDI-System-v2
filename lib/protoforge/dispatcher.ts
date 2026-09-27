import { createClient } from '@supabase/supabase-js';
import { createTimedClient } from '../supabase-timed';
import { updateSessionState } from '../session-state';
import { verifyAuthorizationSignature, payloadDigest } from '../governance/approval-signing';
import type { ActionAuthorization } from '../governance/ActionChokepoint';

export interface DispatchAction {
  type: string;
  payload: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
  reversible: boolean;
  /**
   * Verified approval, minted by the authorization path and bound to
   * (action.type, sha256(payload)). Required — a bare `{ risk:'low' }` claim
   * is not approval. See the gate note on executeApprovedActions.
   */
  authorization?: ActionAuthorization;
}

export interface DispatchResult {
  type: string;
  success: boolean;
  output?: unknown;
  error?: string;
}

function getSupabase() {
  return createTimedClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function dispatchCreateTask(payload: Record<string, unknown>): Promise<DispatchResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('actions').insert({
    task_name: payload.task_name ?? 'protoforge_task',
    status: 'pending',
    payload,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) return { type: 'create_task', success: false, error: error.message };
  return { type: 'create_task', success: true, output: data };
}

async function dispatchSendAlert(payload: Record<string, unknown>): Promise<DispatchResult> {
  const supabase = getSupabase();
  const { error } = await supabase.from('actions').insert({
    task_name: 'alert',
    status: 'completed',
    payload: { ...payload, alerted_at: new Date().toISOString() },
    created_at: new Date().toISOString(),
  });

  if (error) return { type: 'send_alert', success: false, error: error.message };
  console.warn('[ProtoForge][ALERT]', payload.message ?? JSON.stringify(payload));
  return { type: 'send_alert', success: true };
}

async function dispatchQuarantineEvent(payload: Record<string, unknown>): Promise<DispatchResult> {
  const supabase = getSupabase();
  const eventId = payload.event_id;
  if (!eventId) return { type: 'quarantine_event', success: false, error: 'event_id required' };

  const { error } = await supabase
    .from('actions')
    .update({ status: 'failed', payload: { ...payload, quarantined_at: new Date().toISOString() } })
    .eq('id', eventId);

  if (error) return { type: 'quarantine_event', success: false, error: error.message };
  return { type: 'quarantine_event', success: true };
}

async function dispatchUpdateSession(payload: Record<string, unknown>): Promise<DispatchResult> {
  const sessionId = payload.session_id as string | undefined;
  if (!sessionId) return { type: 'update_session', success: false, error: 'session_id required' };

  // eslint-disable-next-line no-unused-vars -- destructured only to exclude session_id from `fields`
  const { session_id: _ignored, ...fields } = payload;
  const { error } = await updateSessionState(getSupabase(), sessionId, fields);

  if (error) return { type: 'update_session', success: false, error };
  return { type: 'update_session', success: true };
}

async function dispatchClearQueue(payload: Record<string, unknown>): Promise<DispatchResult> {
  const supabase = getSupabase();
  const { error, count } = await supabase
    .from('actions')
    .delete({ count: 'exact' })
    .eq('status', 'failed')
    .lt('created_at', payload.older_than ?? new Date(Date.now() - 86_400_000).toISOString());

  if (error) return { type: 'clear_queue', success: false, error: error.message };
  return { type: 'clear_queue', success: true, output: { cleared: count ?? 0 } };
}

async function dispatchTriggerRedeploy(payload: Record<string, unknown>): Promise<DispatchResult> {
  try {
    const { triggerRedeploy, PROJECT_IDS } = await import('../vercel/vercelAdmin.js');
    const projectKey = (payload.project as string) ?? 'hydi';
    const projectId = PROJECT_IDS[projectKey as keyof typeof PROJECT_IDS];

    if (!projectId) {
      return { type: 'trigger_redeploy', success: false, error: `Unknown project key: ${projectKey}` };
    }

    const result = await triggerRedeploy(projectId);
    return { type: 'trigger_redeploy', success: true, output: result };
  } catch (err) {
    return {
      type: 'trigger_redeploy',
      success: false,
      error: err instanceof Error ? err.message : 'Redeploy failed',
    };
  }
}

async function dispatchRestartService(payload: Record<string, unknown>): Promise<DispatchResult> {
  const service = payload.service as string;
  if (service === 'hydi' || service === 'heidi') {
    return dispatchTriggerRedeploy({ project: service });
  }
  return { type: 'restart_service', success: false, error: `No restart handler for service: ${service}` };
}

const DISPATCH_TABLE: Record<
  string,
  (_payload: Record<string, unknown>) => Promise<DispatchResult>
> = {
  create_task: dispatchCreateTask,
  send_alert: dispatchSendAlert,
  quarantine_event: dispatchQuarantineEvent,
  update_session: dispatchUpdateSession,
  clear_queue: dispatchClearQueue,
  trigger_redeploy: dispatchTriggerRedeploy,
  restart_service: dispatchRestartService,
};

/**
 * ProtoForge dispatch — gated (R2, 2026-09-18).
 *
 * This module is currently dormant: nothing calls executeApprovedActions.
 * Before the gate it would have executed `trigger_redeploy` (a real Vercel
 * redeploy), `clear_queue` (mass delete) and `restart_service` purely on the
 * caller-supplied `risk`/`reversible` fields on the action itself — the
 * "approval" in the name was asserted, never verified.
 *
 * The gate: each action must carry an `authorization` whose signature verifies
 * for (action.type, sha256(payload)) — i.e. a real approval minted by the
 * verified-approval path, bound to this exact action. The caller's `risk` and
 * `reversible` claims no longer decide anything. Until a dispatch path exists
 * that mints such signatures, every action is refused — a dormant high-impact
 * dispatcher failing closed is the correct posture, not a regression.
 */
export async function executeApprovedActions(actions: DispatchAction[]): Promise<DispatchResult[]> {
  const results = await Promise.allSettled(
    actions.map((action) => {
      const handler = DISPATCH_TABLE[action.type];
      if (!handler) {
        return Promise.resolve<DispatchResult>({
          type: action.type,
          success: false,
          error: `No dispatcher registered for action type: ${action.type}`,
        });
      }
      // Verified approval bound to this exact action — not a self-asserted
      // risk field. Dispatch isn't session-scoped, so the signature binds
      // (approvedBy|approvalRef|grantedAt|type|<no-session>|payloadDigest).
      if (!action.authorization || !verifyAuthorizationSignature(action.authorization, action.type, undefined, payloadDigest(action.payload))) {
        return Promise.resolve<DispatchResult>({
          type: action.type,
          success: false,
          error: `Action '${action.type}' is not authorized — dispatch requires a verified approval bound to this action`,
        });
      }
      return handler(action.payload);
    })
  );

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { type: actions[i].type, success: false, error: String(r.reason) }
  );
}
