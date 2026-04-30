-- Fix anchor function to handle NULL chain_tip_hash
-- Migration to fix the NOT NULL constraint violation

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

  -- CRITICAL FIX: Ensure chain_tip_hash is never NULL
  if v_chain_head is null then
    v_chain_head := 'EMPTY_' || extract(epoch from now())::text;
  end if;

  -- Build anchor payload
  v_payload := coalesce(v_prev_anchor, 'GENESIS') || '|' || coalesce(v_max_id::text, '0') || '|' || v_chain_head || '|' || now()::text;
  v_anchor := encode(digest(v_payload, 'sha256'), 'hex');

  -- Insert anchor with guaranteed non-null chain_tip_hash
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

-- Ensure permissions are correct
grant execute on function public.keeper_compute_anchor(text) to service_role;
