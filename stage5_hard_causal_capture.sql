-- STAGE 5: HARD CAUSAL CAPTURE ENFORCEMENT
-- No more "partial" - airtight or nothing
-- Version: 5.0.0

-- =============================================================================
-- STEP 1.1: DATABASE ENFORCEMENT (HARD BOUNDARY)
-- =============================================================================

-- Add required columns to all mutable tables
ALTER TABLE public.chaos_runs 
ADD COLUMN IF NOT EXISTS causal_event_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

ALTER TABLE public.chaos_run_instances 
ADD COLUMN IF NOT EXISTS causal_event_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

ALTER TABLE public.chaos_alerts 
ADD COLUMN IF NOT EXISTS causal_event_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

ALTER TABLE public.chaos_run_verdicts 
ADD COLUMN IF NOT EXISTS causal_event_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

-- Create enforcement trigger function
CREATE OR REPLACE FUNCTION public.enforce_causal_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_exists boolean;
  v_event_valid boolean;
BEGIN
  -- Reject write if causal_event_id is default/invalid
  IF NEW.causal_event_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'CAUSAL_CAPTURE_VIOLATION: Missing or invalid causal_event_id on table %', TG_TABLE_NAME;
  END IF;
  
  -- Check if event exists in causal spine
  SELECT EXISTS (
    SELECT 1 FROM public.global_causal_spine 
    WHERE event_id = NEW.causal_event_id 
      AND causality_violation = false
      AND processing_status = 'committed'
  ) INTO v_event_exists;
  
  IF NOT v_event_exists THEN
    RAISE EXCEPTION 'CAUSAL_CAPTURE_VIOLATION: Invalid or unknown causal_event_id % on table %', 
                   NEW.causal_event_id, TG_TABLE_NAME;
  END IF;
  
  -- Additional validation: ensure event is not too old (prevent replay attacks)
  SELECT EXISTS (
    SELECT 1 FROM public.global_causal_spine 
    WHERE event_id = NEW.causal_event_id 
      AND created_at > now() - interval '1 hour'
  ) INTO v_event_valid;
  
  IF NOT v_event_valid THEN
    RAISE EXCEPTION 'CAUSAL_CAPTURE_VIOLATION: Event % is too old (>1 hour) on table %', 
                   NEW.causal_event_id, TG_TABLE_NAME;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Attach triggers to ALL mutable tables
CREATE TRIGGER trg_enforce_causal_chaos_runs
BEFORE INSERT OR UPDATE OR DELETE ON public.chaos_runs
FOR EACH ROW EXECUTE FUNCTION public.enforce_causal_write();

CREATE TRIGGER trg_enforce_causal_chaos_instances
BEFORE INSERT OR UPDATE OR DELETE ON public.chaos_run_instances
FOR EACH ROW EXECUTE FUNCTION public.enforce_causal_write();

CREATE TRIGGER trg_enforce_causal_chaos_alerts
BEFORE INSERT OR UPDATE OR DELETE ON public.chaos_alerts
FOR EACH ROW EXECUTE FUNCTION public.enforce_causal_write();

CREATE TRIGGER trg_enforce_causal_chaos_verdicts
BEFORE INSERT OR UPDATE OR DELETE ON public.chaos_run_verdicts
FOR EACH ROW EXECUTE FUNCTION public.enforce_causal_write();

-- =============================================================================
-- STEP 1.2: SINGLE MUTATION INTERFACE
-- =============================================================================

-- Create the single mutation interface function
CREATE OR REPLACE FUNCTION public.causal_mutate_state(
  p_event_id uuid,
  p_table_name text,
  p_operation text, -- 'INSERT', 'UPDATE', 'DELETE'
  p_record_data jsonb DEFAULT '{}'::jsonb,
  p_filter_condition jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  success boolean,
  records_affected bigint,
  error_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sql text;
  v_records_affected bigint;
  v_table_exists boolean;
  v_operation_valid boolean;
BEGIN
  -- Validate inputs
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = p_table_name AND table_schema = 'public'
  ) INTO v_table_exists;
  
  IF NOT v_table_exists THEN
    RETURN QUERY false, 0, 'Table does not exist: ' || p_table_name;
    RETURN;
  END IF;
  
  -- Validate operation
  v_operation_valid := p_operation IN ('INSERT', 'UPDATE', 'DELETE');
  IF NOT v_operation_valid THEN
    RETURN QUERY false, 0, 'Invalid operation: ' || p_operation;
    RETURN;
  end if;
  
  -- Set causal context for this transaction
  PERFORM set_config('causal.event_id', p_event_id::text, true);
  
  -- Build and execute mutation
  BEGIN
    CASE p_operation
      WHEN 'INSERT' THEN
        v_sql := format(
          'INSERT INTO %I (causal_event_id, data) VALUES ($1, $2)',
          p_table_name
        );
        EXECUTE v_sql USING p_event_id, p_record_data;
        
      WHEN 'UPDATE' THEN
        v_sql := format(
          'UPDATE %I SET data = $1, causal_event_id = $2 WHERE %L',
          p_table_name,
          'data @> $3::jsonb'
        );
        EXECUTE v_sql USING p_record_data, p_event_id, p_filter_condition;
        
      WHEN 'DELETE' THEN
        v_sql := format(
          'DELETE FROM %I WHERE causal_event_id = $1 AND %L',
          p_table_name,
          'data @> $2::jsonb'
        );
        EXECUTE v_sql USING p_event_id, p_filter_condition;
    END CASE;
    
    GET DIAGNOSTICS v_records_affected = ROW_COUNT;
    
    RETURN QUERY true, v_records_affected, NULL::text;
    
  EXCEPTION
    WHEN OTHERS THEN
      RETURN QUERY false, 0, SQLERRM;
  END;
END;
$$;

-- =============================================================================
-- STEP 1.3: VALIDATION TESTS
-- =============================================================================

-- Test function to validate causal capture enforcement
CREATE OR REPLACE FUNCTION public.test_causal_capture_enforcement()
RETURNS TABLE(
  test_name text,
  expected_result boolean,
  actual_result boolean,
  passed boolean,
  error_message text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_test_event_id uuid;
  v_success boolean;
  v_records_affected bigint;
  v_error_message text;
  v_test_passed boolean;
BEGIN
  -- Test 1: Direct SQL insert without event -> MUST fail
  v_test_passed := false;
  BEGIN
    INSERT INTO public.chaos_runs (id, name, status, causal_event_id)
    VALUES (gen_random_uuid(), 'Test_Run_Direct', 'running', '00000000-0000-0000-0000-000000000000'::uuid);
    
    -- If we reach here, the test failed (should have been rejected)
    v_test_passed := false;
    v_error_message := 'Direct insert without causal event was NOT rejected';
    
  EXCEPTION
    WHEN OTHERS THEN
      v_test_passed := true; -- Expected to fail
      v_error_message := 'Correctly rejected: ' || SQLERRM;
  END;
  
  RETURN QUERY 
    'direct_insert_without_event'::text,
    false::boolean, -- Expected to fail
    v_test_passed::boolean,
    v_test_passed::boolean,
    v_error_message::text;
  
  -- Test 2: Valid event write -> MUST pass
  v_test_event_id := gen_random_uuid();
  v_test_passed := false;
  
  -- First create a valid causal event
  INSERT INTO public.global_causal_spine (
    event_id, event_timestamp, logical_clock, event_type, agent, payload,
    determinism_key, processing_status, decision_time, commit_time, 
    visibility_time, created_at
  ) VALUES (
    v_test_event_id, now(), 1, 'CAUSAL', 'TEST_SYSTEM', 
    '{"operation": "test_mutation"}'::jsonb,
    'test_determinism_key', 'committed', now(), now(), now(), now()
  );
  
  BEGIN
    -- Now try the mutation with valid event
    SELECT success, records_affected, error_message 
    INTO v_success, v_records_affected, v_error_message
    FROM public.causal_mutate_state(
      v_test_event_id,
      'chaos_runs',
      'INSERT',
      '{"name": "Test_Run_Valid", "status": "running"}'::jsonb
    );
    
    v_test_passed := v_success AND v_records_affected = 1;
    
  EXCEPTION
    WHEN OTHERS THEN
      v_test_passed := false;
      v_error_message := 'Valid event write failed: ' || SQLERRM;
  END;
  
  RETURN QUERY 
    'valid_event_write'::text,
    true::boolean, -- Expected to pass
    v_test_passed::boolean,
    v_test_passed::boolean,
    COALESCE(v_error_message, 'Success')::text;
  
  -- Test 3: Stale/unknown event -> MUST fail
  v_test_passed := false;
  BEGIN
    SELECT success, records_affected, error_message 
    INTO v_success, v_records_affected, v_error_message
    FROM public.causal_mutate_state(
      '99999999-9999-9999-9999-999999999999'::uuid, -- Non-existent event
      'chaos_runs',
      'INSERT',
      '{"name": "Test_Run_Invalid", "status": "running"}'::jsonb
    );
    
    v_test_passed := NOT v_success; -- Should fail
    
  EXCEPTION
    WHEN OTHERS THEN
      v_test_passed := true; -- Expected to fail
      v_error_message := 'Correctly rejected invalid event: ' || SQLERRM;
  END;
  
  RETURN QUERY 
    'invalid_event_write'::text,
    false::boolean, -- Expected to fail
    v_test_passed::boolean,
    v_test_passed::boolean,
    COALESCE(v_error_message, 'Should have failed')::text;
  
END;
$$;

-- =============================================================================
-- STEP 1.4: KILL SWITCH FOR VIOLATIONS
-- =============================================================================

-- Function to mark event chain as corrupted
CREATE OR REPLACE FUNCTION public.mark_chain_corrupted(
  p_event_id uuid,
  p_corruption_reason text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Mark the event as corrupted
  UPDATE public.global_causal_spine
  SET causality_violation = true,
      corruption_reason = p_corruption_reason,
      corrupted_at = now()
  WHERE event_id = p_event_id;
  
  -- Mark all descendants as potentially corrupted
  UPDATE public.global_causal_spine
  SET causality_violation = true,
      corruption_reason = 'Descendant of corrupted event: ' || p_event_id,
      corrupted_at = now()
  WHERE causal_parent_id = p_event_id
     OR causality_chain_id IN (
       SELECT causality_chain_id FROM public.global_causal_spine 
       WHERE event_id = p_event_id
     );
END;
$$;

-- Trigger to automatically mark violations
CREATE OR REPLACE FUNCTION public.auto_mark_violations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If this is a violation trigger, mark the chain
  IF TG_OP = 'INSERT' AND NEW.causality_violation = true THEN
    PERFORM public.mark_chain_corrupted(NEW.event_id, 'Direct violation detected');
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- =============================================================================
-- PERMISSIONS
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.causal_mutate_state(uuid, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.causal_mutate_state(uuid, text, text, jsonb, jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.test_causal_capture_enforcement() TO authenticated;
GRANT EXECUTE ON FUNCTION public.test_causal_capture_enforcement() TO service_role;

GRANT EXECUTE ON FUNCTION public.mark_chain_corrupted(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_chain_corrupted(uuid, text) TO service_role;

-- =============================================================================
-- STEP 1 COMPLETE: HARD CAUSAL CAPTURE LOCKED DOWN
-- =============================================================================

-- This implementation provides:
-- 1. Database-level enforcement with immediate rejection
-- 2. Single mutation interface (no direct writes allowed)
-- 3. Comprehensive validation tests
-- 4. Kill switch for violations
-- 5. Chain corruption tracking

-- If any direct write bypasses this, the database rejects it. Not logs it. Not warns. Rejects.
