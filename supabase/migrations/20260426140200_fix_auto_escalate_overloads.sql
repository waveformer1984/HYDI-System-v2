-- Fix keeper_auto_escalate function signature conflicts
-- Drop all versions and recreate single clean version

-- Drop all existing versions to eliminate conflicts
DROP FUNCTION IF EXISTS public.keeper_auto_escalate();
DROP FUNCTION IF EXISTS public.keeper_auto_escalate(p_denied_threshold integer, p_error_threshold integer, p_window_minutes integer, p_max_level integer);

-- Create single clean version
CREATE OR REPLACE FUNCTION public.keeper_auto_escalate()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
declare
  v_current_level integer := 0;
  v_new_level integer := 0;
  v_denied_5m integer := 0;
  v_error_5m integer := 0;
  v_throttled_5m integer := 0;
  v_approval_required_5m integer := 0;
  v_prev_hash text;
  v_row_hash text;
  v_req_id uuid := gen_random_uuid();
begin
  -- Get current circuit level
  select coalesce(level, 0)
    into v_current_level
  from public.keeper_circuit_state
  where id = 1;

  -- Count recent events
  select
    count(*) filter (where status = 'denied')::int,
    count(*) filter (where status = 'error')::int,
    count(*) filter (where status = 'throttled')::int,
    count(*) filter (where status = 'approval_required')::int
  into
    v_denied_5m,
    v_error_5m,
    v_throttled_5m,
    v_approval_required_5m
  from public.keeper_audit_log
  where created_at >= now() - interval '5 minutes';

  -- Calculate new level based on thresholds
  if v_error_5m >= 20 or v_denied_5m >= 40 then
    v_new_level := 3;
  elsif v_error_5m >= 10 or v_denied_5m >= 20 or v_throttled_5m >= 20 or v_approval_required_5m >= 30 then
    v_new_level := 2;
  elsif v_error_5m >= 5 or v_denied_5m >= 10 then
    v_new_level := 1;
  else
    v_new_level := v_current_level;
  end if;

  -- Escalate if needed
  if v_new_level > v_current_level then
    update public.keeper_circuit_state
    set
      level = least(4, v_new_level),
      reason = 'auto_escalate_threshold',
      set_by = 'keeper_auto_escalate',
      updated_at = now()
    where id = 1;

    -- Log the escalation
    select l.row_hash
      into v_prev_hash
    from public.keeper_audit_log l
    order by l.id desc
      limit 1;

    v_row_hash := encode(
      digest(
        coalesce(v_prev_hash, 'GENESIS') || '|' || v_req_id::text || '|system:auto_escalate|' || least(4, v_new_level)::text || '|' || now()::text,
        'sha256'
      ),
      'hex'
    );

    insert into public.keeper_audit_log (
      request_id,
      agent_id,
      agent_role,
      action,
      target,
      status,
      risk_level,
      details,
      sensitive,
      prev_hash,
      row_hash
    ) values (
      v_req_id,
      'system',
      'governor',
      'system:auto_escalate',
      'keeper_circuit_state',
      'success',
      least(4, v_new_level),
      jsonb_build_object(
        'previous_level', v_current_level,
        'new_level', least(4, v_new_level),
        'denied_5m', v_denied_5m,
        'error_5m', v_error_5m,
        'throttled_5m', v_throttled_5m,
        'approval_required_5m', v_approval_required_5m
      ),
      true,
      v_prev_hash,
      v_row_hash
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'current_level', v_current_level,
    'computed_level', least(4, v_new_level),
    'denied_5m', v_denied_5m,
    'error_5m', v_error_5m,
    'throttled_5m', v_throttled_5m,
    'approval_required_5m', v_approval_required_5m
  );
end;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.keeper_auto_escalate() TO service_role;

COMMENT ON FUNCTION public.keeper_auto_escalate() IS 'Automatic circuit escalation based on recent error/denial patterns';
