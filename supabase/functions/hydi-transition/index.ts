// supabase/functions/hydi-transition/index.ts
// HYDI State Transition Gateway - Atomic transitions with invariant enforcement

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { requireServiceRole } from "../_shared/security.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

interface TransitionRequest {
  run_id: string;
  from: string;
  to: string;
  payload: Record<string, unknown>;
  actor: 'ursula' | 'auditor' | 'executor' | 'verifier';
  idempotency_key: string;
}

// Allowed transitions FSM
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  'initialized': ['audit'],
  'audit': ['execute', 'failed'],
  'execute': ['verify', 'reopen_audit', 'failed'],
  'verify': ['completed', 'reopen_audit', 'failed'],
  'reopen_audit': ['audit']
};

// Actor permissions
const ACTOR_PERMISSIONS: Record<string, string[]> = {
  'ursula': ['initialized', 'audit'],
  'auditor': ['audit', 'execute', 'failed'],
  'executor': ['execute', 'verify', 'reopen_audit', 'failed'],
  'verifier': ['verify', 'completed', 'reopen_audit', 'failed']
};

Deno.serve(async (req: Request) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }
  
  // Internal-only state-transition gateway: any caller who can invoke it
  // can advance HYDI run state. verify_jwt=true alone only proves *a* JWT
  // was presented (the public anon key qualifies), not that the caller is
  // privileged -- see ISSUES_FOUND.md.
  const authError = requireServiceRole(req);
  if (authError) return authError;

  const body = await req.json() as TransitionRequest;
  const { run_id, from, to, payload, actor, idempotency_key } = body;

  try {
    // 1. Validate actor permission
    if (!ACTOR_PERMISSIONS[actor]?.includes(to)) {
      return new Response(
        JSON.stringify({ 
          error: `Actor ${actor} cannot transition to ${to}`,
          allowed: ACTOR_PERMISSIONS[actor] || []
        }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // 2. Validate transition is allowed
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      return new Response(
        JSON.stringify({ 
          error: `Illegal transition: ${from} → ${to}`,
          allowed_from: ALLOWED_TRANSITIONS[from] || []
        }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // 3. Acquire lease for this transition
    const { data: leaseToken, error: leaseError } = await supabase.rpc(
      'acquire_or_takeover_lease',
      {
        p_run_id: run_id,
        p_phase: to,
        p_agent: actor,
        p_ttl_seconds: 30
      }
    );
    
    if (leaseError) {
      return new Response(
        JSON.stringify({ error: `Lease acquisition failed: ${leaseError.message}` }), 
        { status: 423, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // 4. Start transaction - check current state
    const { data: currentRun, error: fetchError } = await supabase
      .from('hydi_runs')
      .select('current_phase, status, findings_count, verification_failed')
      .eq('run_id', run_id)
      .single();
    
    if (fetchError || !currentRun) {
      return new Response(
        JSON.stringify({ error: `Run not found: ${run_id}` }), 
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // 5. Verify from phase matches
    if (currentRun.current_phase !== from) {
      return new Response(
        JSON.stringify({ 
          error: `Phase mismatch: expected ${from}, got ${currentRun.current_phase}` 
        }), 
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // 6. Check invariants
    const { error: invariantError } = await supabase.rpc('assert_invariants', {
      p_phase: to,
      p_status: to === 'completed' ? 'COMPLETED' : 'RUNNING',
      p_findings_count: currentRun.findings_count || 0,
      p_verification_failed: currentRun.verification_failed || 0
    });
    
    if (invariantError) {
      return new Response(
        JSON.stringify({ error: `Invariant violation: ${invariantError.message}` }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // 7. Check idempotency (duplicate key)
    const { data: existingEvent } = await supabase
      .from('hydi_events')
      .select('event_id, seq')
      .eq('run_id', run_id)
      .eq('type', 'PHASE_TRANSITION')
      .eq('to_phase', to)
      .limit(1)
      .single();
    
    if (existingEvent) {
      // Idempotent - return existing
      return new Response(
        JSON.stringify({ 
          success: true,
          event_id: existingEvent.event_id,
          seq: existingEvent.seq,
          idempotent: true,
          message: 'Transition already recorded'
        }), 
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // 8. Get next sequence number
    const { data: maxSeq } = await supabase
      .from('hydi_events')
      .select('seq')
      .eq('run_id', run_id)
      .order('seq', { ascending: false })
      .limit(1)
      .single();
    
    const nextSeq = (maxSeq?.seq || 0) + 1;
    
    // 9. Insert event
    const { data: event, error: eventError } = await supabase
      .from('hydi_events')
      .insert({
        run_id,
        seq: nextSeq,
        type: 'PHASE_TRANSITION',
        actor,
        from_phase: from,
        to_phase: to,
        payload,
        idempotency_key
      })
      .select('event_id')
      .single();
    
    if (eventError) {
      throw eventError;
    }
    
    // 10. Update run state
    const updates: Record<string, unknown> = {
      current_phase: to,
      current_actor: actor
    };
    
    if (to === 'completed' || to === 'failed') {
      updates.status = to;
      updates.completed_at = new Date().toISOString();
    }
    
    const { error: updateError } = await supabase
      .from('hydi_runs')
      .update(updates)
      .eq('run_id', run_id);
    
    if (updateError) {
      throw updateError;
    }
    
    // 11. Release lease
    await supabase.rpc('force_release_lease', {
      p_run_id: run_id,
      p_phase: to,
      p_reason: 'transition_complete'
    });
    
    return new Response(
      JSON.stringify({ 
        success: true,
        event_id: event.event_id,
        seq: nextSeq,
        run_id,
        from,
        to,
        actor
      }), 
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Transition error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal error', 
        details: error instanceof Error ? error.message : String(error)
      }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
