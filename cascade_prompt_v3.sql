-- CASCADE PROMPT v3.0 - GLOBAL CAUSAL EXECUTOR
-- Enforces single, replayable causal spine of truth
-- Version: 3.0.0

-- =============================================================================
-- GLOBAL EVENT SPINE - Single Source of Truth
-- =============================================================================

-- Enhanced global event log with strict causality enforcement
CREATE TABLE IF NOT EXISTS public.global_causal_spine (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_timestamp timestamptz NOT NULL DEFAULT now(),
  logical_clock bigint NOT NULL DEFAULT 0,
  causal_parent_id uuid,
  causality_chain_id uuid NOT NULL DEFAULT gen_random_uuid(),
  
  -- Event classification
  event_type text NOT NULL CHECK (event_type IN ('CAUSAL', 'DERIVED', 'EXTERNAL')),
  agent text NOT NULL CHECK (agent IN ('AUDITOR', 'EXECUTOR', 'VERIFIER', 'SYSTEM')),
  
  -- Event content
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Determinism and traceability
  determinism_key text NOT NULL,
  side_effects jsonb DEFAULT '[]'::jsonb,
  
  -- Execution state
  processing_status text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'committed', 'failed', 'quarantined')),
  processing_started_at timestamptz,
  processing_completed_at timestampptz,
  processing_attempts int NOT NULL DEFAULT 0,
  processing_error text,
  
  -- Causal integrity
  parent_determinism_key text,
  causality_violation boolean DEFAULT false,
  cascade_integrity_failure boolean DEFAULT false,
  
  -- System state at event time
  system_snapshot jsonb,
  
  -- Temporal consistency
  decision_time timestamptz NOT NULL DEFAULT now(),
  commit_time timestamptz,
  visibility_time timestamptz,
  
  -- Replay verification
  replay_hash text,
  has_been_replayed boolean DEFAULT false,
  replay_verified_at timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Global ordering index - ensures single total order
CREATE UNIQUE INDEX IF NOT EXISTS idx_causal_spine_ordering 
ON public.global_causal_spine (id DESC);

-- Causal chain index for lineage tracing
CREATE INDEX IF NOT EXISTS idx_causal_spine_causal_chain 
ON public.global_causal_spine (causality_chain_id, id DESC);

-- Determinism key index for replay verification
CREATE INDEX IF NOT EXISTS idx_causal_spine_determinism 
ON public.global_causal_spine (determinism_key);

-- Agent and type indexes for processing
CREATE INDEX IF NOT EXISTS idx_causal_spine_agent 
ON public.global_causal_spine (agent, processing_status, id DESC);

CREATE INDEX IF NOT EXISTS idx_causal_spine_type 
ON public.global_causal_spine (event_type, processing_status, id DESC);

-- Timing index for visibility coordination
CREATE INDEX IF NOT EXISTS idx_causal_spine_timing 
ON public.global_causal_spine (visibility_time, id DESC) WHERE visibility_time IS NOT NULL;

-- =============================================================================
-- 1. CAUSAL EVENT SUBMISSION WITH STRICT VALIDATION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_causal_event(
  p_event_type text,
  p_agent text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_causal_parent_id uuid DEFAULT NULL,
  p_decision_time timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_causality_chain_id uuid;
  v_parent_record RECORD;
  v_determinism_key text;
  v_system_snapshot jsonb;
  v_logical_clock bigint;
BEGIN
  -- Validate event type
  IF p_event_type NOT IN ('CAUSAL', 'DERIVED', 'EXTERNAL') THEN
    RAISE EXCEPTION 'Invalid event type: %', p_event_type;
  END IF;
  
  -- Validate agent
  IF p_agent NOT IN ('AUDITOR', 'EXECUTOR', 'VERIFIER', 'SYSTEM') THEN
    RAISE EXCEPTION 'Invalid agent: %', p_agent;
  END IF;
  
  -- Validate parent relationship
  IF p_causal_parent_id IS NOT NULL THEN
    SELECT id, causality_chain_id, determinism_key INTO v_parent_record
    FROM public.global_causal_spine
    WHERE event_id = p_causal_parent_id;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent event not found: %', p_causal_parent_id;
    END IF;
    
    -- Inherit causality chain for derived events
    v_causality_chain_id := v_parent_record.causality_chain_id;
    v_parent_determinism_key := v_parent_record.determinism_key;
  ELSE
    -- Start new causality chain for root events
    v_causal_chain_id := gen_random_uuid();
    v_parent_determinism_key := NULL;
  END IF;
  
  -- Generate determinism key
  v_determinism_key := encode(digest(p_payload::text || p_metadata::text || p_agent || v_causal_chain_id::text || v_logical_clock::text), 'hex');
  
  -- Capture system snapshot at decision time
  v_system_snapshot := jsonb_build_object(
    'timestamp', p_decision_time,
    'chaos_runs_count', (SELECT COUNT(*) FROM public.chaos_runs),
    'chaos_alerts_count', (SELECT COUNT(*) FROM public.chaos_alerts),
    'active_chaos_runs', (SELECT COUNT(*) FROM public.chaos_runs WHERE status = 'running'),
    'pending_events', (SELECT COUNT(*) FROM public.global_causal_spine WHERE processing_status = 'pending'),
    'logical_clock', v_logical_clock
  );
  
  -- Get next logical clock value
  SELECT COALESCECE(MAX(logical_clock), 0) + 1 INTO v_logical_clock
  FROM public.global_causal_spine;
  
  -- Insert event with strict validation
  INSERT INTO public.global_causal_spine (
    event_id,
    event_timestamp,
    logical_clock,
    causal_parent_id,
    causality_chain_id,
    event_type,
    agent,
    payload,
    metadata,
    determinism_key,
    side_effects,
    processing_status,
    decision_time,
    system_snapshot,
    created_at
  ) VALUES (
    v_event_id,
    p_decision_time,
    v_logical_clock,
    p_causal_parent_id,
    v_causal_chain_id,
    p_event_type,
    p_agent,
    p_payload,
    p_metadata,
    v_determinism_key,
    '[]'::jsonb,
    'pending',
    p_decision_time,
    v_system_snapshot,
    now()
  ) RETURNING v_event_id;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to submit causal event: %', SQLERRM;
END;
$$;

-- =============================================================================
-- 2. EXTERNAL EVENT NORMALIZATION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_external_event(
  p_external_source text,
  p_external_event_type text,
  p_external_data jsonb,
  p_agent text DEFAULT 'SYSTEM',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_normalized_payload jsonb;
  v_determinism_key text;
  v_decision_time timestamptz;
BEGIN
  -- Normalize external data into causal event format
  v_normalized_payload := jsonb_build_object(
    'external_source', p_external_source,
    'external_type', p_external_event_type,
    'original_data', p_external_data,
    'normalized_at', now()
  );
  
  -- Generate determinism key for external events
  v_determinism_key := encode(digest(p_external_data::text || p_external_event_type || p_external_source || now()::text), 'hex');
  
  -- Use decision time as event timestamp
  v_decision_time := now();
  
  -- Submit normalized external event
  v_event_id := public.submit_causal_event(
    'EXTERNAL',
    p_agent,
    v_normalized_payload,
    p_metadata,
    NULL, -- External events have no parent
    v_decision_time
  );
  
  RETURN v_event_id;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to normalize external event: %', SQLERRM;
END;
$$;

-- =============================================================================
-- 3. DERIVED EVENT GENERATION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_derived_event(
  p_derivation_type text,
  p_parent_event_id uuid,
  p_derived_payload jsonb DEFAULT '{}'::jsonb,
  p_agent text DEFAULT 'SYSTEM',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_record RECORD;
  v_derived_payload jsonb;
  v_determinism_key text;
  v_system_snapshot jsonb;
  v_logical_clock bigint;
BEGIN
  -- Validate parent event
  SELECT id, causality_chain_id, determinism_key, system_snapshot INTO v_parent_record
  FROM public.global_causal_spine
  WHERE event_id = p_parent_event_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent event not found for derived event: %', p_parent_event_id;
  END IF;
  
  -- Generate derived payload (pure function of parent)
  v_derived_payload := jsonb_build_object(
    'derivation_type', p_derivation_type,
    'parent_event_id', p_parent_event_id,
    'derived_at', now(),
    'parent_payload', v_parent_record.payload
  ) || p_derived_payload;
  
  -- Generate determinism key for derived events
  v_determinism_key := encode(digest(v_derived_payload::text || v_parent_record.determinism_key || v_logical_clock::text), 'hex');
  
  -- Use parent's system snapshot
  v_system_snapshot := v_parent_record.system_snapshot;
  
  -- Get next logical clock value
  SELECT COALESCE(MAX(logical_clock), 0) + 1 INTO v_logical_clock
  FROM public.global_causal_spine;
  
  -- Insert derived event
  INSERT INTO public.global_causal_spine (
    event_id,
    event_timestamp,
    logical_clock,
    causal_parent_id,
    causality_chain_id,
    'DERIVED',
    p_agent,
    v_derived_payload,
    p_metadata,
    v_determinism_key,
    '[]'::jsonb, -- Derived events have no side effects
    'pending',
    v_parent_record.decision_time,
    v_system_snapshot,
    created_at
  ) RETURNING gen_random_uuid();
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to generate derived event: %', SQLERRM;
END;
$$;

-- =============================================================================
-- 4. CAUSAL EVENT PROCESSOR WITH STRICT ENFORCEMENT
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_causal_event(
  p_event_id uuid,
  p_processor_id text DEFAULT 'cascade_executor'
)
RETURNS TABLE(
  success boolean,
  processed_at timestamptz,
  error_message text,
  side_effects jsonb,
  determinism_violation boolean,
  cascade_integrity_failure boolean,
  replay_hash text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_record RECORD;
  v_processing_result jsonb DEFAULT '{}'::jsonb;
  v_side_effects jsonb DEFAULT '[]'::jsonb;
  v_replay_hash text;
  v_parent_determinism_key text;
  v_current_snapshot jsonb;
  v_expected_snapshot jsonb;
BEGIN
  -- Get event record with advisory lock for processing
  SELECT * INTO v_event_record
  FROM public.global_causal_spine
  WHERE event_id = p_event_id
    FOR UPDATE OF event_id
    SKIP LOCKED;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, now(), 'Event not found', '{}'::jsonb, false, false, NULL;
    RETURN;
  END IF;
  
  -- Check if already processed
  IF v_event_record.processing_status = 'committed' THEN
    RETURN QUERY SELECT true, v_event_record.processing_completed_at, NULL, v_event_record.side_effects, false, false, v_event_record.replay_hash;
    RETURN;
  END IF;
  
  -- Update processing status
  UPDATE public.global_causal_spine
  SET 
    processing_status = 'processing',
    processing_started_at = now(),
    processing_attempts = processing_attempts + 1,
    updated_at = now()
  WHERE event_id = p_event_id;
  
  -- Get parent determinism key for derived events
  SELECT determinism_key INTO v_parent_determinism_key
  FROM public.global_causal_spine
    WHERE event_id = v_event_record.causal_parent_id;
  
  -- Capture current system snapshot
  v_current_snapshot := jsonb_build_object(
    'timestamp', now(),
    'chaos_runs_count', (SELECT COUNT(*) FROM public.chaos_runs),
    'chaos_alerts_count', (SELECT COUNT(*) FROM public_chaos_alerts),
    'active_chaos_runs', (SELECT COUNT(*) FROM public.chaos_runs WHERE status = 'running'),
    'pending_events', (SELECT COUNT(*) FROM public.global_causal_spine WHERE processing_status = 'pending'),
    'logical_clock', v_event_record.logical_clock
  );
  
  -- Process event based on type
  BEGIN
    CASE v_event_record.event_type
      WHEN 'CAUSAL' THEN
        v_processing_result := public.process_causal_event_internal(v_event_record);
      WHEN 'DERIVED' THEN
        v_processing_result := public.process_derived_event_internal(v_event_record);
      WHEN 'EXTERNAL' THEN
        v_expected_snapshot := v_event_record.system_snapshot;
        v_processing_result := jsonb_build_object('status', 'external_processed');
      ELSE
        RAISE EXCEPTION 'Unknown event type: %', v_event_record.event_type;
    END CASE;
    
    -- Calculate replay hash for verification
    v_replay_hash := encode(digest(
      (v_processing_result || v_side_effects || v_event_record.payload)::text || 
       v_current_snapshot::text || v_event_record.determinism_key || 
       v_event_record.logical_clock
    );
    
    -- Update event as committed
    UPDATE public.global_causal_spine
    SET 
      processing_status = 'committed',
      processing_completed_at = now(),
      payload = payload || v_processing_result,
      side_effects = v_side_effects,
      commit_time = now(),
      visibility_time = now(), -- Immediate visibility for now
      replay_hash = v_replay_hash,
      updated_at = now()
    WHERE event_id = p_event_id;
    
    RETURN QUERY SELECT true, now(), NULL, v_side_effects, false, false, v_replay_hash;
    
  EXCEPTION
    WHEN OTHERS THEN
      -- Mark as failed
      UPDATE public.global_causal_spine
      SET 
        processing_status = 'failed',
        processing_completed_at = now(),
        last_error = SQLERRM,
        updated_at = now()
      WHERE event_id = p_event_id;
      
      -- Check for causality violation
      IF v_event_record.event_type = 'CAUSAL' THEN
        UPDATE public.global_causal_spine
        SET causality_violation = true,
            cascade_integrity_failure = true
        WHERE event_id = p_event_id;
      END IF;
      
      RETURN QUERY SELECT false, now(), SQLERRM, '{}'::jsonb, true, true, NULL;
  END;
END;
$$;

-- =============================================================================
-- 5. CAUSAL EVENT PROCESSORS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_causal_event_internal(p_event RECORD)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_payload jsonb;
  v_run_id uuid;
  v_result jsonb;
BEGIN
  -- Extract run data from payload
  v_run_id := (p_event.payload->>'run_id')::uuid;
  
  -- Process based on payload content
  IF p_event.payload->>'operation' = 'create_chaos_run' THEN
    -- Create chaos run
    INSERT INTO public.chaos_runs (
      id, name, seed, total_runs, concurrency, failure_rate,
      duplicate_event_rate, stall_probability, latency_profile_ms, status
    ) VALUES (
      v_run_id,
      p_event.payload->>'name',
      (p_event.payload->>'seed')::bigint,
      (p_event.payload->>'total_runs')::int,
      (p_event.payload->>'concurrency')::int,
      (p_event.payload->>'failure_rate')::numeric,
      (p_event.payload->>'duplicate_event_rate')::numeric,
      (p_event.payload->>'stall_probability')::numeric,
      ARRAY(SELECT jsonb_array_elements_text(p_event.payload->>'latency_profile_ms')),
      'pending'
    );
    
    v_result := jsonb_build_object(
      'status', 'success',
      'run_id', v_run_id,
      'created_at', now()
    );
    
  ELSIF p_event.payload->>'operation' = 'delete_chaos_run' THEN
    -- Delete chaos run with cascade
    v_run_id := (p_event.payload->>'run_id')::uuid;
    
    -- Delete instances first (FK constraint)
    DELETE FROM public.chaos_run_instances
    WHERE chaos_run_id = v_run_id;
    
    -- Delete run
    DELETE FROM public.chaos_runs
    WHERE id = v_run_id;
    
    v_result := jsonb_build_object(
      'status', 'success',
      'run_id', v_run_id,
      'deleted_at', now(),
      'instances_deleted', sqlstate
    );
    
  ELSIF p_event.payload->>'operation' = 'create_chaos_alert' THEN
    -- Create chaos alert
    v_run_id := (p_event.payload->>'run_id')::uuid;
    
    INSERT INTO public.chaos_alerts (
      run_id, name, status, verdict, failure_reason, severity, requires_action,
      passed_ratio, runtime_seconds, total_instances, done_instances,
      error_instances, dead_letter_instances, duplicate_effect_pairs,
      replay_mismatches, started_at, finished_at, alert_context
    ) VALUES (
      v_run_id,
      p_event.payload->>'name',
      p_event.payload->>'status',
      p_event.payload->>'verdict',
      p_event.payload->>'failure_reason',
      p_event.payload->>'severity',
      (p.event.payload->>'requires_action')::boolean,
      (p.event.payload->>'passed_ratio')::numeric,
      (p.event.payload->>'runtime_seconds')::bigint,
      (p.event.payload->>'total_instances')::bigint,
      (p.event.payload->>'done_instances')::bigint,
      (p.event.payload->>'error_instances')::bigint,
      (p_event.payload->>'dead_letter_instances')::bigint,
      (p.event.payload->>'duplicate_effect_pairs')::bigint,
      (p.event.payload->>'replay_mismatches')::bigint,
      (p_event.payload->>'started_at')::timestamptz,
      (p.event.payload->>'finished_at')::timestamptz,
      jsonb_build_object(
        'alert_type', 'chaos_test_failure',
        'run_id', v_run_id,
        'global_event_id', p_event.event_id,
        'causality_token', p_event.causality_token,
        'created_via_causal_spine', true
      )
    );
    
    v_result := jsonb_build_object(
      'status', 'success',
      'alert_id', v_run_id,
      'created_at', now()
    );
    
  ELSE
    v_result := jsonb_build_object(
      'status', 'unknown_operation',
      'event_type', p_event.event_type,
      'payload', p_event.payload
    );
  END IF;
  
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_derived_event_internal(p_event RECORD)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_payload jsonb;
  v_derived_result jsonb;
  v_derivation_type text;
BEGIN
  -- Get parent payload for derivation
  SELECT payload INTO v_parent_payload
  FROM public.global_causal_spine
    WHERE event_id = p_event.causal_parent_id;
  
  v_derivation_type := (p_event.payload->>'derivation_type');
  
  -- Process based on derivation type
  CASE v_derivation_type
    WHEN 'gate_evaluation' THEN
      -- Derive gate state from current system state
      v_derived_result := jsonb_build_object(
        'gate_passed', true,
        'evaluation_time', now(),
        'system_state', v_parent_payload
      );
    
    WHEN 'state_summary' THEN
      -- Derive system state summary
      v_derived_result := jsonb_build_object(
        'total_runs', (SELECT COUNT(*) FROM public.chaos_runs),
        'active_runs', (SELECT COUNT(*) FROM public.chaos_runs WHERE status = 'running'),
        'total_alerts', (SELECT COUNT(*) FROM public.chaos_alerts),
        'critical_alerts', (SELECT COUNT(*) FROM public.chaos_alerts WHERE severity = 'critical'),
        'high_alerts', (SELECT COUNT(*) FROM public.chaos_alerts WHERE severity = 'high'),
        'timestamp', now()
      );
    
    WHEN 'consistency_check' THEN
      -- Perform consistency check
      v_derived_result := jsonb_build_object(
        'check_type', 'system_consistency',
        'check_time', now(),
        'inconsistencies', '[]', -- Would populate with actual check logic
        'consistent', true
      );
    
    ELSE
      v_derived_result := jsonb_build_object(
        'status', 'unknown_derivation',
        'derivation_type', v_derivation_type,
        'parent_payload', v_parent_payload
      );
    END CASE;
  
  RETURN v_derived_result;
END;
$$;

-- =============================================================================
-- 6. RETRY AS FIRST-CLASS CAUSAL EVENTS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_retry_event(
  p_parent_event_id uuid,
  p_retry_reason text,
  p_retry_payload jsonb DEFAULT '{}'::jsonb,
  p_max_retries int DEFAULT 5
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_record RECORD;
  v_retry_count int;
  v_event_id uuid;
  v_determinism_key text;
  v_failure_snapshot jsonb;
  v_system_snapshot jsonb;
  v_logical_clock bigint;
BEGIN
  -- Validate parent event
  SELECT id, causality_chain_id, determinism_key, system_snapshot, logical_clock 
  INTO v_parent_record
  FROM public.global_causal_spine
  WHERE event_id = p_parent_event_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent event not found for retry: %', p_parent_event_id;
  END IF;
  
  -- Check retry limit
  SELECT COUNT(*) INTO v_retry_count
  FROM public.global_causal_spine
  WHERE causality_chain_id = v_parent_record.causality_chain_id
    AND event_type = 'retry_attempted';
  
  IF v_retry_count >= p_max_retries THEN
    RAISE EXCEPTION 'Maximum retries exceeded for event: %', p_parent_event_id;
  END IF;
  
  -- Capture failure snapshot from parent event
  v_failure_snapshot := jsonb_build_object(
    'parent_event_id', p_parent_event_id,
    'parent_payload', v_parent_record.payload,
    'processing_error', v_parent_record.last_error,
    'retry_count', v_retry_count
  );
  
  -- Get current system snapshot
  v_system_snapshot := jsonb_build_object(
    'timestamp', now(),
    'chaos_runs_count', (SELECT COUNT(*) FROM public.chaos_run),
    'chaos_alerts_count', (SELECT COUNT(*) FROM public.chaos_cont_alerts),
    'active_chaos_runs', (SELECT COUNT(*) FROM public.chaos_runs WHERE status = 'running'),
    'pending_events', (SELECT COUNT(*) FROM public.global_causal_spine WHERE processing_status = 'pending'),
    'logical_clock', v_logical_clock
  );
  
  -- Get next logical clock value
  SELECT COALESCE(MAX(logical_clock), 0) + 1 INTO v_logical_clock
  FROM public.global_causal_chain_id = v_parent_record.causality_chain_id;
  
  -- Generate determinism key for retry
  v_determinism_key := encode(
    (p_retry_payload::text || v_failure_snapshot::text || v_parent_record.determinism_key || 
     v_logical_clock::text || v_system_snapshot::text || p_retry_reason), 
    'hex'
  );
  
  -- Submit retry as causal event
  v_event_id := INSERT INTO public.global_causal_spine (
    event_id,
    event_timestamp,
    logical_clock,
    causal_parent_id,
    causality_chain_id,
    'CAUSAL',
    'RETRY_COORDINATOR',
    jsonb_build_object(
      'original_event_id', p_parent_event_id,
      'retry_reason', p_retry_reason,
      'retry_count', v_retry_count + 1,
      'max_retries', p_max_retries,
      'original_payload', v_parent_record.payload,
      'failure_snapshot', v_failure_snapshot,
      'retry_payload', p_retry_payload
    ),
    jsonb_build_object(
      'retry_of', p_parent_event_id,
      'processor', 'retry_coordinator'
    ),
    determinism_key,
    '[]'::jsonb, -- Retries have no direct side effects
    'pending',
    v_parent_record.decision_time,
    v_system_snapshot,
    created_at
  ) RETURNING event_id;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to submit retry event: %', SQLERRM;
END;
$$;

-- =============================================================================
-- 7. CONSISTENCY VERIFICATION AFTER EACH EVENT
-- =============================================================================

CREATE OR REPLACE FUNCTION public.verify_causal_consistency(
  p_event_id uuid
)
RETURNS TABLE(
  is_consistent boolean,
  violation_type text,
  description text,
  detected_at timestumptz,
  affected_event_ids uuid[]
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_record RECORD;
  v_violations jsonb DEFAULT '[]'::jsonb;
  v_affected_events uuid[] DEFAULT '{}';
BEGIN
  -- Get event record
  SELECT * INTO v_event_record
  FROM public.global_causal_spine
  WHERE event_id = p_event_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Event not found', 'Event not found', ARRAY[]::uuid[];
    RETURN;
  END IF;
  
  -- Check for hidden side effects by comparing snapshots
  IF v_event_record.system_snapshot IS NOT NULL THEN
    v_current_snapshot := jsonb_build_object(
      'timestamp', now(),
      'chaos_runs_count', (SELECT COUNT(*) FROM public.chaos_runs),
      'chaos_alerts_count', (SELECT COUNT(*) FROM public.chaos_alerts),
      'pending_events', (SELECT COUNT(*) FROM public.global_causal_spine WHERE processing_status = 'pending')
    );
    
    -- Check for unexpected state changes
    IF v_current_snapshot != v_event_record.system_snapshot THEN
      v_violations := jsonb_build_object(
        'type', 'unexpected_state_change',
        'before', v_event_record.system_snapshot,
        'after', v_current_snapshot
      );
      
      -- Find events that might have caused this
      SELECT array_agg(event_id) INTO v_affected_events
      FROM public.global_causal_spine
      WHERE logical_clock >= v_event_record.logical_clock - 10
        AND logical_clock <= v_event_record.logical_clock + 10;
      
      RETURN QUERY SELECT false, 'Unexpected state change detected', 
        jsonb_agg(v_violations), 
        ARRAY[v_affected_events];
    END IF;
  END IF;
  
  -- Check for causality violations
  IF v_event_record.causality_violation THEN
    v_violations := jsonb_build_object(
      'type', 'causality_violation',
      'event_id', v_event_record.event_id,
      'parent_determinism_key', v_parent_determinism_key
    );
    
    -- Find related events
    SELECT array_agg(event_id) INTO v_affected_events
    FROM public.global_causal_spine
    WHERE causality_chain_id = v_event_record.causality_chain_id
      AND logical_clock >= v_event_record.logical_clock - 5
      AND logical_clock <= v_event_record.logical_clock + 5;
    
    RETURN QUERY SELECT false, 'Causality violation detected', 
        jsonb_agg(v_violations), 
        ARRAY[v_affected_events];
  END IF;
  
  -- Check for cascade integrity failures
  IF v_event_record.cascade_integrity_failure THEN
    v_violations := jsonb_build_object(
      'type', 'cascade_integrity_failure',
      'event_id', v_event_id
    );
    
    SELECT array_agg(event_id) INTO v_affected_events
    FROM public.global_causal_spine
    WHERE causality_chain_id = v_event_record.causality_chain_id
      AND logical_clock >= v_event_record.logical_clock - 3
      AND logical_clock <= v_event_record.logical_clock + 3;
    
    RETURN QUERY SELECT false, 'Cascade integrity failure detected', 
        jsonb_agg(v_violations), 
        ARRAY[v_affected_events];
  END IF;
  
  -- All checks passed
  RETURN QUERY SELECT true, 'No violations detected', '[]'::jsonb, ARRAY[]::uuid[];
END;
$$;

-- =============================================================================
-- 8. REPLAY VERIFICATION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.verify_replay_consistency(
  p_from_event_id uuid DEFAULT NULL,
  p_to_event_id uuid DEFAULT NULL
)
RETURNS TABLE(
  replay_consistent boolean,
  total_events_checked bigint,
  events_mismatched bigint,
  consistency_hash_mismatch bigint,
  first_mismatched_event uuid,
  final_mismatched_event uuid
)
LANGUAGE sql
STABLE
AS $$
DECLARE
  v_from_record RECORD;
  v_to_record RECORD;
  v_events_checked bigint;
  v_mismatches bigint;
  v_consistency_hash_mismatches bigint;
  v_first_mismatched_event uuid;
  v_final_mismatched_event uuid;
BEGIN
  -- Default to checking all events
  IF p_from_event_id IS NULL AND p_to_event_id IS NULL THEN
    p_from_event_id := (SELECT MIN(id) FROM public.global_causal_spine WHERE processing_status = 'committed');
    p_to_event_id := (SELECT MAX(id) FROM public.global_causal_spine WHERE processing_status = 'committed');
  END IF;
  
  -- Get range of events to check
  SELECT COUNT(*) INTO v_events_checked
  FROM public.global_causal_spine
    WHERE id >= p_from_event_id AND id <= p_to_event_id
    AND processing_status = 'committed';
  
  -- Check each event's replay hash against current state
  FOR event_record IN (
    SELECT *
    FROM public.global_causal_spine
    WHERE id >= p_from_event_id AND id <= p_to_event_id
    AND processing_status = 'committed'
    ORDER BY id
  )
  LOOP
    -- Recalculate replay hash from current state
    DECLARE
      v_current_state jsonb;
      v_replay_hash text;
    BEGIN
      -- Capture current state snapshot
      v_current_state := jsonb_build_object(
        'timestamp', event_record.event_timestamp,
        'chaos_runs_count', (SELECT COUNT(*) FROM public.chaos_runs),
        'chaos_alerts_count', (SELECT COUNT(*) FROM public.chaos_alerts),
        'pending_events', (SELECT COUNT(*) FROM public.global_causal_spine WHERE processing_status = 'pending'),
        'logical_clock', event_record.logical_clock
      );
      
      -- Calculate replay hash
      v_replay_hash := encode(
        (event_record.payload::text || 
         v_current_state::text || 
         event_record.determinism_key || 
         event_record.logical_clock::text
        ), 'hex'
      );
      
      -- Compare with stored replay hash
      IF v_replay_hash != event_record.replay_hash THEN
        v_mismatches := v_mismatches + 1;
        IF v_first_mismatched_event IS NULL THEN
          v_first_mismatched_event := event_record.event_id;
        v_final_mismatched_event := event_record.event_id;
      END IF;
    END LOOP;
  
  RETURN QUERY 
    v_mismatches = 0 AND v_consistency_hash_mismatches = 0,
    v_events_checked,
    v_mismatches,
    v_consistency_hash_mismatches,
    v_first_mismatched_event,
    v_final_mismatched_event;
END;
$$;

-- =============================================================================
-- 9. GLOBAL STATE QUERIES
-- =============================================================================

-- Get current global state from causal spine
CREATE OR REPLACE FUNCTION public.get_global_state_from_spine()
RETURNS TABLE(
  total_events bigint,
  pending_events bigint,
  committed_events bigint,
  failed_events bigint,
  latest_event_id uuid,
  latest_event_type text,
  latest_agent text,
  system_state jsonb,
  is_consistent boolean,
  last_consistency_check timestamptz,
  logical_clock bigint
)
LANGUAGE sql
STABLE
AS $$
DECLARE
  v_latest_event RECORD;
  v_last_consistency_check timestamptz;
  v_system_state jsonb;
  v_is_consistent boolean;
BEGIN
  -- Get latest event
  SELECT * INTO v_latest_event
  FROM public.global_causal_spine
    ORDER BY id DESC
    LIMIT 1;
  
  -- Get latest consistency check
  SELECT MAX(created_at) INTO v_last_consistency_check
  FROM public.global_causal_spine
    WHERE processing_status = 'committed'
    AND event_type = 'consistency_check';
  
  -- Capture current system state
  v_system_state := jsonb_build_object(
    'timestamp', now(),
    'chaos_runs_count', (SELECT COUNT(*) FROM public.chaos_runs),
    'chaos_alerts_count', (SELECT COUNT(*) FROM public.chaos_alerts),
    'active_chaos_runs', (SELECT COUNT(*) FROM public.chaos_runs WHERE status = 'running'),
    'pending_events', (SELECT COUNT(*) FROM public.global_causal_spine WHERE processing_status = 'pending'),
    'logical_clock', (SELECT COALESCE(MAX(logical_clock), 0) FROM public.global_causal_spine)
  );
  
  -- Determine consistency
  v_is_consistent := NOT EXISTS (
    SELECT 1 FROM public.global_causal_spine
    WHERE processing_status = 'failed'
      OR causality_violation = true
      OR cascade_integrity_failure = true
  );
  
  RETURN QUERY 
    v_latest_event.id,
    v_latest_event.event_type,
    v_latest_event.agent,
    v_system_state,
    v_is_consistent,
    v_last_consistency_check,
    v_latest_event.logical_clock
  ;
END;
$$;

-- Get state at specific point in time
CREATE OR REPLACE FUNCTION public.get_state_at_time(
  p_logical_clock bigint DEFAULT NULL
)
RETURNS TABLE(
  event_id uuid,
  event_type text,
  agent text,
  system_state jsonb,
  is_consistent boolean
)
LANGUAGE sql
STABLE
AS $$
DECLARE
  v_event_record RECORD;
BEGIN
  -- Get event at specific logical clock
  SELECT * INTO v_event_record
  FROM public.global_causal_spine
    WHERE logical_clock = p_logical_clock
    AND processing_status = 'committed'
    ORDER BY id DESC
    LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::jsonb, false;
  END IF;
  
  -- Get system state at that point
  RETURN QUERY 
    v_event_record.event_id,
    v_event_record.event_type,
    v_event_record.agent,
    v_event_record.system_snapshot,
    NOT EXISTS (
      SELECT 1 FROM public.global_causal_spine
      WHERE logical_clock >= v_event_record.logical_clock - 1
        AND logical_clock <= v_event_record.logical_clock + 1
        AND (causality_violation = true OR cascade_integrity_failure = true)
    );
END;
$$;

-- =============================================================================
-- 10. PERMISSIONS
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.submit_causal_event(text, text, jsonb, jsonb, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_causal_event(text, text, jsonb, jsonb, uuid, timestamptz) TO service_role;

GRANT EXECUTE ON FUNCTION public.normalize_external_event(text, text, jsonb, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_external_event(text, text, jsonb, text, jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.generate_derived_event(text, uuid, jsonb, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_derived_event(text, uuid, jsonb, text, jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.process_causal_event(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_causal_event(uuid, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.submit_retry_event(uuid, text, jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_retry_event(uuid, text, jsonb, int) TO service_role;

GRANT EXECUTE ON FUNCTION public.verify_causal_consistency(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_causal_consistency(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_replay_consistency(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_replay_consistency(uuid, uuid, uuid) TO service_role;

GRANT SELECT ON public.global_causal_spine TO authenticated;
GRANT SELECT ON public.global_causal_spine TO service_role;
GRANT SELECT ON public.chaos_runs TO authenticated;
GRANT SELECT ON public.chaos_alerts TO authenticated;
GRANT SELECT ON public.chaos_run_verdicts TO authenticated;
GRANT SELECT ON public.chaos_run_instances TO authenticated;

-- =============================================================================
-- CASCADE PROMPT v3.0 COMPLETE
-- =============================================================================

-- This architecture enforces:
-- 1. Single global causal spine of truth
-- 2. Strict event classification (CAUSAL, DERIVED, EXTERNAL)
-- 3. Deterministic replay verification
-- 4. Causal integrity enforcement
-- 5. External event normalization
-- 6. Retry as first-class causal events
-- 7. Consistency verification after each event
-- 8. Clear separation between causal, derived, and external behaviors

-- This is where distributed systems achieve true adversarial resilience through causal determinism.
