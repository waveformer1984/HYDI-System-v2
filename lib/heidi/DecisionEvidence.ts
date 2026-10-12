/**
 * DECISION EVIDENCE — refusals are evidence too.
 *
 * The govern chain already records its positive legs: proposals land in
 * heidi_action_proposals, decisions in heidi_events via ActionProposals,
 * executed cycles via recordCycle() (cognitive_cycle rows). The leg that
 * left no trace was the refusal: evaluateAction() in the chokepoint
 * returns AUTHORIZATION_REQUIRED / INVALID_AUTHORIZATION / PROHIBITED /
 * UNKNOWN_ACTION to the caller, and the only record of "the system said
 * no, here is why" was a string in a response body.
 *
 * A refused action is a real governed outcome — for audit, for detecting
 * repeated unauthorized attempts, and for proving the gate actually fires
 * rather than silently allowing. This module persists it to heidi_events.
 *
 * Fail-soft by contract: the refusal already happened and is already the
 * truth the caller sees. A missing table or dead connection must never
 * change that answer or throw back into the governed path.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionGateDecision } from '../governance/ActionChokepoint';

export interface RefusalRecord {
  decision: ActionGateDecision;
  sessionId?: string;
}

/**
 * Persist a refused gate decision as a heidi_events row.
 * event_type='action_refused', verdict=<gate code>, division='agents'
 * (same division AgentControlPlane uses for agent-layer governance rows).
 * Never throws; returns an error string on failure for the caller's log.
 */
export async function recordActionRefusal(
  supabase: SupabaseClient | null | undefined,
  record: RefusalRecord,
): Promise<string | null> {
  if (!supabase) return 'no supabase client';
  const { decision } = record;
  try {
    const { error } = await supabase.from('heidi_events').insert({
      event_type: 'action_refused',
      division: 'agents',
      verdict: decision.code,
      payload: {
        actionId: decision.actionId,
        type: decision.type,
        requester: decision.requester,
        target: decision.target ?? null,
        risk: decision.risk,
        code: decision.code,
        reason: decision.reason,
        sessionId: record.sessionId ?? null,
      },
    });
    return error ? error.message : null;
  } catch (e) {
    return e instanceof Error ? e.message : 'refusal evidence write failed';
  }
}
