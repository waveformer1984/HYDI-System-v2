-- Final SQL Hardening Pack - Fix chain_tip_hash issue
-- This addresses the NOT NULL constraint on chain_tip_hash

create or replace function public.keeper_compute_anchor(p_sink text default 'local_db')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_max_id bigint;
  v_chain_head text;
  v_prev_anchor text;
  v_payload text;
  v_anchor text;
  v_id bigint;
  v_row_count bigint;
begin
  -- Get latest audit log entry
  select l.id, l.row_hash
    into v_max_id, v_chain_head
  from public.keeper_audit_log l
  order by l.id desc
  limit 1;

  -- Get total row count
  select count(*)::bigint
    into v_row_count
  from public.keeper_audit_log;

  -- Get previous anchor
  select a.anchor_hash
    into v_prev_anchor
  from public.keeper_audit_anchors a
  order by a.id desc
  limit 1;

  -- Ensure chain_tip_hash is never NULL
  v_chain_head := coalesce(v_chain_head, 'EMPTY');

  -- Build anchor payload
  v_payload := coalesce(v_prev_anchor, 'GENESIS') || '|' || coalesce(v_max_id::text, '0') || '|' || v_chain_head || '|' || now()::text;
  v_anchor := encode(digest(v_payload, 'sha256'), 'hex');

  -- Insert anchor with all required fields
  insert into public.keeper_audit_anchors (
    anchored_at,
    last_audit_id,
    row_count,
    chain_tip_hash,
    anchor_hash,
    created_by
  ) values (
    now(),
    v_max_id,
    v_row_count,
    v_chain_head,
    v_anchor,
    p_sink
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'anchor_id', v_id,
    'audit_log_max_id', v_max_id,
    'chain_head_hash', v_chain_head,
    'anchor_hash', v_anchor,
    'row_count', v_row_count
  );
end;
$$;

-- Test the function
select public.keeper_compute_anchor('local_db') as anchor_result;

-- Verify cron jobs
select jobname, schedule, command, active 
from cron.job 
where jobname in ('keeper-anchor-5min','keeper-escalate-1min') 
order by jobname;
