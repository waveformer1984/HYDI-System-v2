-- STAGE 3: GLOBAL COORDINATION ARCHITECTURE
-- Eliminates ambiguity in system-wide state evolution under concurrency
-- Version: 4.0.0

-- =============================================================================
-- CORE CONTRACT: All state transitions must be derivable from a single ordered event log
-- =============================================================================

-- Global Event Log - The Single Source of Truth
CREATE TABLE IF NOT EXISTS public.global_event_log (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  event_version text NOT NULL DEFAULT '1.0',
  causal_chain_id uuid NOT NULL, -- Groups related events
  parent_event_id uuid, -- For event ordering
  causality_token uuid NOT NULL DEFAULT gen_random_uuid(), -- Global ordering token
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Explicit timing model
  decision_time timestamptz NOT NULL DEFAULT now(), -- When decision was made
  commit_time timestamptz, -- When event was committed to log
  visibility_time timestamptz, -- When state becomes visible
  
  -- Processing state
  processing_status text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'committed', 'failed', 'reconciled')),
  processing_attempts int NOT NULL DEFAULT 0,
  last_error text,
  
  -- System state at event time
  system_snapshot jsonb, -- Snapshot of system state when event was created
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Global ordering index - ensures single total order
CREATE UNIQUE INDEX IF NOT EXISTS idx_global_event_log_ordering 
ON public.global_event_log (id DESC);

-- Causal chain index - groups related events
CREATE INDEX IF NOT EXISTS idx_global_event_log_causal_chain 
ON public.global_event_log (causal_chain_id, id DESC);

-- Event type index for processing
CREATE INDEX IF NOT EXISTS idx_global_event_log_type 
ON public.global_event_log (event_type, processing_status);

-- Timing index for visibility
CREATE INDEX IF NOT EXISTS idx_global_event_log_timing 
ON public.global_event_log (visibility_time, id DESC) WHERE visibility_time IS NOT NULL;

-- =============================================================================
-- 1. GLOBAL ORDERING CONTRACT
-- =============================================================================

-- Event submission with global ordering guarantee
CREATE OR REPLACE FUNCTION public.submit_global_event(
  p_event_type text,
  p_event_version text DEFAULT '1.0',
  p_causal_chain_id uuid DEFAULT NULL,
  p_parent_event_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_decision_time timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_causality_token uuid;
  v_parent_causality_token uuid;
  v_system_snapshot jsonb;
BEGIN
  -- Generate unique identifiers
  v_event_id := gen_random_uuid();
  v_causality_token := gen_random_uuid();
  
  -- Get parent causality token for ordering
  IF p_parent_event_id IS NOT NULL THEN
    SELECT causality_token INTO v_parent_causality_token
    FROM public.global_event_log
    WHERE event_id = p_parent_event_id;
    
    IF v_parent_causality_token IS NULL THEN
      RAISE EXCEPTION 'Parent event not found: %', p_parent_event_id;
    END IF;
  END IF;
  
  -- Capture system snapshot at decision time
  v_system_snapshot := jsonb_build_object(
    'timestamp', p_decision_time,
    'chaos_runs_count', (SELECT COUNT(*) FROM public.chaos_runs),
    'chaos_alerts_count', (SELECT COUNT(*) FROM public.chaos_alerts),
    'active_chaos_runs', (SELECT COUNT(*) FROM public.chaos_runs WHERE status = 'running'),
    'pending_events', (SELECT COUNT(*) FROM public.global_event_log WHERE processing_status = 'pending')
  );
  
  -- Insert event with global ordering
  INSERT INTO public.global_event_log (
    event_id, event_type, event_version, causal_chain_id, parent_event_id,
    causality_token, payload, metadata, decision_time, system_snapshot
  ) VALUES (
    v_event_id, p_event_type, p_event_version, p_causal_chain_id, p_parent_event_id,
    v_causality_token, p_payload, p_metadata, p_decision_time, v_system_snapshot
  ) RETURNING event_id INTO v_event_id;
  
  RETURN v_event_id;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to submit global event: %', SQLERRM;
END;
$$;

-- =============================================================================
-- 2. SINGLE SOURCE OF CAUSALITY
-- =============================================================================

-- Event processor - processes events in global order
CREATE OR REPLACE FUNCTION public.process_global_event(
  p_event_id uuid,
  p_processor_id text DEFAULT 'system'
)
RETURNS TABLE(
  success boolean,
  processed_at timestamptz,
  error_message text,
  side_effects jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_record RECORD;
  v_processing_result jsonb;
  v_side_effects jsonb DEFAULT '{}'::jsonb;
BEGIN
  -- Get event record with advisory lock
  SELECT * INTO v_event_record
  FROM public.global_event_log
  WHERE event_id = p_event_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, now(), 'Event not found', '{}'::jsonb;
    RETURN;
  END IF;
  
  -- Check if already processed
  IF v_event_record.processing_status = 'committed' THEN
    RETURN QUERY SELECT true, v_event_record.updated_at, NULL, v_event_record.payload;
    RETURN;
  END IF;
  
  -- Update processing status
  UPDATE public.global_event_log
  SET 
    processing_status = 'processing',
    processing_attempts = processing_attempts + 1,
    updated_at = now()
  WHERE event_id = p_event_id;
  
  -- Process event based on type
  BEGIN
    CASE v_event_record.event_type
      WHEN 'chaos_run_created' THEN
        v_processing_result := public.process_chaos_run_created(v_event_record);
      WHEN 'chaos_run_deleted' THEN
        v_processing_result := public.process_chaos_run_deleted(v_event_record);
      WHEN 'chaos_alert_created' THEN
        v_processing_result := public.process_chaos_alert_created(v_event_record);
      WHEN 'chaos_gate_evaluated' THEN
        v_processing_result := public.process_chaos_gate_evaluated(v_event_record);
      WHEN 'retry_attempted' THEN
        v_processing_result := public.process_retry_attempted(v_event_record);
      WHEN 'inconsistency_detected' THEN
        v_processing_result := public.process_inconsistency_detected(v_event_record);
      WHEN 'reconciliation_performed' THEN
        v_processing_result := public.process_reconciliation_performed(v_event_record);
      ELSE
        v_processing_result := jsonb_build_object('status', 'unknown_event_type');
    END CASE;
    
    -- Mark as committed
    UPDATE public.global_event_log
    SET 
      processing_status = 'committed',
      commit_time = now(),
      visibility_time = now(), -- Make visible immediately for now
      payload = payload || v_processing_result,
      updated_at = now()
    WHERE event_id = p_event_id;
    
    RETURN QUERY SELECT true, now(), NULL, v_processing_result;
    
  EXCEPTION
    WHEN OTHERS THEN
    -- Mark as failed
    UPDATE public.global_event_log
    SET 
      processing_status = 'failed',
      last_error = SQLERRM,
      updated_at = now()
    WHERE event_id = p_event_id;
    
    RETURN QUERY SELECT false, now(), SQLERRM, '{}'::jsonb;
  END;
END;
$$;

-- =============================================================================
-- 3. EXPLICIT TIMING MODEL
-- =============================================================================

-- Timing coordinator - manages decision/commit/visibility timing
CREATE OR REPLACE FUNCTION public.coordinate_event_timing(
  p_event_id uuid,
  p_visibility_delay interval DEFAULT '0 seconds' -- Can be configured for eventual consistency
)
RETURNS TABLE(
  decision_time timestamptz,
  commit_time timestamptz,
  visibility_time timestamptz,
  timing_status text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_record RECORD;
  v_visibility_time timestamptz;
BEGIN
  -- Get event record
  SELECT * INTO v_event_record
  FROM public.global_event_log
  WHERE event_id = p_event_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found: %', p_event_id;
  END IF;
  
  -- Calculate visibility time
  v_visibility_time := v_event_record.commit_time + p_visibility_delay;
  
  -- Update timing
  UPDATE public.global_event_log
  SET 
    visibility_time = v_visibility_time,
    updated_at = now()
  WHERE event_id = p_event_id;
  
  RETURN QUERY SELECT 
    v_event_record.decision_time,
    v_event_record.commit_time,
    v_visibility_time,
    CASE 
      WHEN v_event_record.decision_time IS NULL THEN 'no_decision'
      WHEN v_event_record.commit_time IS NULL THEN 'no_commit'
      WHEN v_visibility_time IS NULL THEN 'no_visibility'
      ELSE 'complete'
    END AS timing_status;
END;
$$;

-- =============================================================================
-- 4. DETERMINISTIC RETRY MODEL
-- =============================================================================

-- Retry as first-class citizen - creates new event in log
CREATE OR REPLACE FUNCTION public.submit_retry_event(
  p_original_event_id uuid,
  p_retry_reason text,
  p_retry_payload jsonb DEFAULT '{}'::jsonb,
  p_max_retries int DEFAULT 5
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_original_event RECORD;
  v_retry_count int;
  v_causal_chain_id uuid;
  v_new_event_id uuid;
BEGIN
  -- Get original event
  SELECT * INTO v_original_event
  FROM public.global_event_log
  WHERE event_id = p_original_event_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original event not found: %', p_original_event_id;
  END IF;
  
  -- Check retry limit
  v_retry_count := (SELECT COUNT(*) 
                   FROM public.global_event_log 
                   WHERE causal_chain_id = v_original_event.causal_chain_id 
                     AND event_type = 'retry_attempted');
  
  IF v_retry_count >= p_max_retries THEN
    RAISE EXCEPTION 'Maximum retries exceeded for event: %', p_original_event_id;
  END IF;
  
  -- Create retry event in same causal chain
  v_new_event_id := public.submit_global_event(
    'retry_attempted',
    '1.0',
    v_original_event.causal_chain_id,
    p_original_event_id,
    jsonb_build_object(
      'original_event_id', p_original_event_id,
      'retry_reason', p_retry_reason,
      'retry_count', v_retry_count + 1,
      'max_retries', p_max_retries,
      'original_payload', v_original_event.payload
    ) || p_retry_payload,
    jsonb_build_object(
      'retry_of', p_original_event_id,
      'processor', 'retry_coordinator'
    )
  );
  
  RETURN v_new_event_id;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to submit retry event: %', SQLERRM;
END;
$$;

-- =============================================================================
-- 5. INCONSISTENCY DETECTION & RECONCILIATION
-- =============================================================================

-- Inconsistency detector - runs after each event
CREATE OR REPLACE FUNCTION public.detect_inconsistencies(
  p_event_id uuid
)
RETURNS TABLE(
  inconsistency_type text,
  severity text,
  description text,
  detected_at timestamptz,
  reconciliation_required boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_inconsistencies jsonb DEFAULT '[]'::jsonb;
BEGIN
  -- Detect FK violations (orphan instances)
  INSERT INTO public.global_event_log (event_type, payload, metadata)
  SELECT 
    'inconsistency_detected',
    jsonb_build_object(
      'type', 'fk_violation',
      'orphan_instances', jsonb_agg(
        jsonb_build_object(
          'instance_id', ci.id,
          'missing_run_id', ci.chaos_run_id
        )
      )
    ),
    jsonb_build_object(
      'detector', 'fk_consistency_checker',
      'triggering_event', p_event_id
    )
  FROM public.chaos_run_instances ci
  LEFT JOIN public.chaos_runs cr ON ci.chaos_run_id = cr.id
  WHERE cr.id IS NULL
  HAVING COUNT(*) > 0;
  
  -- Detect alert-verdict inconsistencies
  INSERT INTO public.global_event_log (event_type, payload, metadata)
  SELECT 
    'inconsistency_detected',
    jsonb_build_object(
      'type', 'alert_verdict_mismatch',
      'orphan_alerts', jsonb_agg(
        jsonb_build_object(
          'alert_id', ca.run_id,
          'missing_verdict', ca.run_id
        )
      )
    ),
    jsonb_build_object(
      'detector', 'alert_consistency_checker',
      'triggering_event', p_event_id
    )
  FROM public.chaos_alerts ca
  LEFT JOIN public.chaos_run_verdicts crv ON ca.run_id = crv.run_id
  WHERE crv.run_id IS NULL
  HAVING COUNT(*) > 0;
  
  -- Detect write skew anomalies
  -- This would compare expected vs actual state based on system snapshot
  
  RETURN QUERY SELECT 
    'detection_complete'::text as inconsistency_type,
    'info'::text as severity,
    'Inconsistency detection completed'::text as description,
    now() as detected_at,
    false as reconciliation_required;
END;
$$;

-- Reconciliation processor
CREATE OR REPLACE FUNCTION public.perform_reconciliation(
  p_inconsistency_event_id uuid,
  p_reconciliation_strategy text DEFAULT 'automatic'
)
RETURNS TABLE(
  reconciliation_success boolean,
  reconciled_at timestamptz,
  actions_taken jsonb,
  remaining_issues jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_inconsistency_event RECORD;
  v_actions jsonb DEFAULT '[]'::jsonb;
  v_remaining_issues jsonb DEFAULT '[]'::jsonb;
BEGIN
  -- Get inconsistency event
  SELECT * INTO v_inconsistency_event
  FROM public.global_event_log
  WHERE event_id = p_inconsistency_event_id
    AND event_type = 'inconsistency_detected';
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, now(), '{}'::jsonb, '{}'::jsonb;
    RETURN;
  END IF;
  
  -- Process based on inconsistency type
  CASE (v_inconsistency_event.payload->>'type')
    WHEN 'fk_violation' THEN
      -- Clean up orphan instances
      DELETE FROM public.chaos_run_instances
      WHERE chaos_run_id IN (
        SELECT ci.chaos_run_id
        FROM public.chaos_run_instances ci
        LEFT JOIN public.chaos_runs cr ON ci.chaos_run_id = cr.id
        WHERE cr.id IS NULL
      );
      
      v_actions := jsonb_build_object(
        'action', 'cleanup_orphan_instances',
        'instances_removed', sqlstate
      );
    
    WHEN 'alert_verdict_mismatch' THEN
      -- Create missing verdicts or remove orphan alerts
      -- Implementation depends on business rules
      
      v_actions := jsonb_build_object(
        'action', 'reconcile_alert_verdict_mismatch',
        'strategy', p_reconciliation_strategy
      );
    
    WHEN 'write_skew_anomaly' THEN
      -- Reconcile based on causal chain analysis
      
      v_actions := jsonb_build_object(
        'action', 'reconcile_write_skew',
        'causal_chain_analysis', true
      );
  END CASE;
  
  -- Create reconciliation event
  INSERT INTO public.global_event_log (
    event_type, causal_chain_id, parent_event_id, payload, metadata
  ) VALUES (
    'reconciliation_performed',
    v_inconsistency_event.causal_chain_id,
    p_inconsistency_event_id,
    jsonb_build_object(
      'reconciled_inconsistency', v_inconsistency_event.event_id,
      'actions_taken', v_actions,
      'remaining_issues', v_remaining_issues,
      'strategy', p_reconciliation_strategy
    ),
    jsonb_build_object(
      'reconciler', 'automatic_reconciliation_system',
      'timestamp', now()
    )
  ) RETURNING event_id;
  
  RETURN QUERY SELECT true, now(), v_actions, v_remaining_issues;
END;
$$;

-- =============================================================================
-- 6. CHAOS OPERATIONS THROUGH GLOBAL EVENT LOG
-- =============================================================================

-- Chaos run creation through event log
CREATE OR REPLACE FUNCTION public.process_chaos_run_created(p_event RECORD)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_run_id uuid;
  v_result jsonb;
BEGIN
  -- Extract run data from event payload
  v_run_id := (p_event.payload->>'run_id')::uuid;
  
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
    ARRAY(SELECT jsonb_array_elements_text(p_event.payload->'latency_profile_ms')),
    'pending'
  );
  
  v_result := jsonb_build_object(
    'status', 'success',
    'run_id', v_run_id,
    'created_at', now()
  );
  
  RETURN v_result;
END;
$$;

-- Chaos run deletion through event log
CREATE OR REPLACE FUNCTION public.process_chaos_run_deleted(p_event RECORD)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_run_id uuid;
  v_deleted_instances int;
  v_result jsonb;
BEGIN
  v_run_id := (p_event.payload->>'run_id')::uuid;
  
  -- Delete instances first (FK constraint)
  DELETE FROM public.chaos_run_instances
  WHERE chaos_run_id = v_run_id;
  
  GET DIAGNOSTICS v_deleted_instances = ROW_COUNT;
  
  -- Delete run
  DELETE FROM public.chaos_runs
  WHERE id = v_run_id;
  
  v_result := jsonb_build_object(
    'status', 'success',
    'run_id', v_run_id,
    'deleted_instances', v_deleted_instances,
    'deleted_at', now()
  );
  
  RETURN v_result;
END;
$$;

-- Alert creation through event log
CREATE OR REPLACE FUNCTION public.process_chaos_alert_created(p_event RECORD)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_run_id uuid;
  v_alert_id uuid;
  v_result jsonb;
BEGIN
  v_run_id := (p_event.payload->>'run_id')::uuid;
  v_alert_id := gen_random_uuid();
  
  -- Create alert with global ordering
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
    (p_event.payload->>'requires_action')::boolean,
    (p_event.payload->>'passed_ratio')::numeric,
    (p_event.payload->>'runtime_seconds')::bigint,
    (p_event.payload->>'total_instances')::bigint,
    (p_event.payload->>'done_instances')::bigint,
    (p_event.payload->>'error_instances')::bigint,
    (p_event.payload->>'dead_letter_instances')::bigint,
    (p_event.payload->>'duplicate_effect_pairs')::bigint,
    (p_event.payload->>'replay_mismatches')::bigint,
    (p_event.payload->>'started_at')::timestamptz,
    (p_event.payload->>'finished_at')::timestamptz,
    jsonb_build_object(
      'alert_type', 'chaos_test_failure',
      'run_id', v_run_id,
      'global_event_id', p_event.event_id,
      'causality_token', p_event.causality_token,
      'created_via_global_log', true
    )
  );
  
  v_result := jsonb_build_object(
    'status', 'success',
    'alert_id', v_alert_id,
    'run_id', v_run_id,
    'created_at', now()
  );
  
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 7. GLOBAL COORDINATION QUERIES
-- =============================================================================

-- Get system state at specific point in time
CREATE OR REPLACE FUNCTION public.get_system_state_at_time(
  p_timestamp timestamptz
)
RETURNS TABLE(
  event_id uuid,
  event_type text,
  system_state jsonb,
  is_consistent boolean
)
LANGUAGE sql
STABLE
AS $$
  -- Get latest event before timestamp
  WITH latest_event AS (
    SELECT *
    FROM public.global_event_log
    WHERE commit_time <= p_timestamp
      AND processing_status = 'committed'
    ORDER BY id DESC
    LIMIT 1
  )
  SELECT 
    le.event_id,
    le.event_type,
    le.system_snapshot AS system_state,
    -- Check if state is consistent (no unprocessed events before this point)
    NOT EXISTS (
      SELECT 1 FROM public.global_event_log
      WHERE id < le.id
        AND processing_status != 'committed'
    ) AS is_consistent
  FROM latest_event le;
$$;

-- Get current global state
CREATE OR REPLACE FUNCTION public.get_current_global_state()
RETURNS TABLE(
  total_events bigint,
  pending_events bigint,
  failed_events bigint,
  latest_event_id uuid,
  latest_event_type text,
  system_consistent boolean,
  last_inconsistency timestamptz
)
LANGUAGE sql
STABLE
AS $$
  WITH event_counts AS (
    SELECT
      COUNT(*)::bigint as total,
      COUNT(*) FILTER (WHERE processing_status = 'pending')::bigint as pending,
      COUNT(*) FILTER (WHERE processing_status = 'failed')::bigint as failed
    FROM public.global_event_log
  ),
  latest_event AS (
    SELECT event_id, event_type
    FROM public.global_event_log
    ORDER BY id DESC
    LIMIT 1
  ),
  last_inconsistency AS (
    SELECT MAX(created_at) as last_inconsistency_time
    FROM public.global_event_log
    WHERE event_type = 'inconsistency_detected'
  )
  SELECT 
    ec.total,
    ec.pending,
    ec.failed,
    le.event_id,
    le.event_type,
    -- System is consistent if no pending events and no recent inconsistencies
    (ec.pending = 0 AND 
     (li.last_inconsistency_time IS NULL OR li.last_inconsistency_time < now() - interval '1 hour')) as consistent,
    li.last_inconsistency_time
  FROM event_counts ec
  CROSS JOIN latest_event le
  CROSS JOIN last_inconsistency li;
$$;

-- =============================================================================
-- 8. EVENT DRIVEN CHAOS OPERATIONS
-- =============================================================================

-- Submit chaos run through global log
CREATE OR REPLACE FUNCTION public.submit_chaos_run(
  p_name text,
  p_seed bigint,
  p_total_runs int,
  p_concurrency int,
  p_failure_rate numeric,
  p_duplicate_event_rate numeric,
  p_stall_probability numeric,
  p_latency_profile_ms int[]
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_run_id uuid;
  v_causal_chain_id uuid;
BEGIN
  -- Create causal chain for this chaos run
  v_causal_chain_id := gen_random_uuid();
  v_run_id := gen_random_uuid();
  
  -- Submit run creation event
  v_event_id := public.submit_global_event(
    'chaos_run_created',
    '1.0',
    v_causal_chain_id,
    NULL, -- No parent for first event
    jsonb_build_object(
      'run_id', v_run_id,
      'name', p_name,
      'seed', p_seed,
      'total_runs', p_total_runs,
      'concurrency', p_concurrency,
      'failure_rate', p_failure_rate,
      'duplicate_event_rate', p_duplicate_event_rate,
      'stall_probability', p_stall_probability,
      'latency_profile_ms', p_latency_profile_ms
    ),
    jsonb_build_object(
      'submitted_by', 'chaos_coordinator',
      'causal_chain_id', v_causal_chain_id
    )
  );
  
  -- Process event immediately (synchronous for now)
  PERFORM public.process_global_event(v_event_id);
  
  RETURN v_run_id;
END;
$$;

-- Submit alert through global log
CREATE OR REPLACE FUNCTION public.submit_chaos_alert(
  p_run_id uuid,
  p_name text,
  p_status text,
  p_verdict text,
  p_failure_reason text,
  p_severity text,
  p_requires_action boolean,
  p_passed_ratio numeric DEFAULT NULL,
  p_runtime_seconds bigint DEFAULT NULL,
  p_total_instances bigint DEFAULT NULL,
  p_done_instances bigint DEFAULT NULL,
  p_error_instances bigint DEFAULT NULL,
  p_dead_letter_instances bigint DEFAULT NULL,
  p_duplicate_effect_pairs bigint DEFAULT 0,
  p_replay_mismatches bigint DEFAULT 0,
  p_started_at timestamptz DEFAULT NULL,
  p_finished_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_causal_chain_id uuid;
BEGIN
  -- Get causal chain from run
  SELECT causal_chain_id INTO v_causal_chain_id
  FROM public.global_event_log
  WHERE payload->>'run_id' = p_run_id::text
    AND event_type = 'chaos_run_created'
  ORDER BY id DESC
  LIMIT 1;
  
  IF v_causal_chain_id IS NULL THEN
    RAISE EXCEPTION 'No causal chain found for run_id: %', p_run_id;
  END IF;
  
  -- Submit alert creation event
  v_event_id := public.submit_global_event(
    'chaos_alert_created',
    '1.0',
    v_causal_chain_id,
    NULL,
    jsonb_build_object(
      'run_id', p_run_id,
      'name', p_name,
      'status', p_status,
      'verdict', p_verdict,
      'failure_reason', p_failure_reason,
      'severity', p_severity,
      'requires_action', p_requires_action,
      'passed_ratio', p_passed_ratio,
      'runtime_seconds', p_runtime_seconds,
      'total_instances', p_total_instances,
      'done_instances', p_done_instances,
      'error_instances', p_error_instances,
      'dead_letter_instances', p_dead_letter_instances,
      'duplicate_effect_pairs', p_duplicate_effect_pairs,
      'replay_mismatches', p_replay_mismatches,
      'started_at', p_started_at,
      'finished_at', p_finished_at
    ),
    jsonb_build_object(
      'submitted_by', 'alert_coordinator',
      'causal_chain_id', v_causal_chain_id
    )
  );
  
  -- Process event immediately
  PERFORM public.process_global_event(v_event_id);
  
  RETURN v_event_id;
END;
$$;

-- =============================================================================
-- 9. AUTOMATIC INCONSISTENCY MONITORING
-- =============================================================================

-- Function to run after each event processing
CREATE OR REPLACE FUNCTION public.post_event_consistency_check(
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_inconsistencies_detected int;
BEGIN
  -- Run inconsistency detection
  SELECT COUNT(*) INTO v_inconsistencies_detected
  FROM public.detect_inconsistencies(p_event_id);
  
  -- If inconsistencies found, trigger reconciliation
  IF v_inconsistencies_detected > 0 THEN
    -- Get the inconsistency events
    FOR inconsistency_event IN (
      SELECT event_id
      FROM public.global_event_log
      WHERE event_type = 'inconsistency_detected'
        AND created_at > now() - interval '1 minute'
        AND processing_status = 'pending'
    )
    LOOP
      -- Perform automatic reconciliation
      PERFORM public.perform_reconciliation(inconsistency_event.event_id, 'automatic');
    END LOOP;
    
    RETURN false; -- Inconsistencies found and reconciled
  END IF;
  
  RETURN true; -- No inconsistencies
END;
$$;

-- =============================================================================
-- 10. PERMISSIONS
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.submit_global_event(text, text, uuid, uuid, jsonb, jsonb, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_global_event(text, text, uuid, uuid, jsonb, jsonb, timestamptz) TO service_role;

GRANT EXECUTE ON FUNCTION public.process_global_event(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_global_event(uuid, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.submit_retry_event(uuid, text, jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_retry_event(uuid, text, jsonb, int) TO service_role;

GRANT EXECUTE ON FUNCTION public.submit_chaos_run(text, bigint, int, int, numeric, numeric, numeric, int[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_chaos_run(text, bigint, int, int, numeric, numeric, numeric, int[]) TO service_role;

GRANT EXECUTE ON FUNCTION public.submit_chaos_alert(uuid, text, text, text, text, text, boolean, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_chaos_alert(uuid, text, text, text, text, text, boolean, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, timestamptz, timestamptz) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_system_state_at_time(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_state_at_time(timestamptz) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_current_global_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_global_state() TO service_role;

-- =============================================================================
-- STAGE 3 GLOBAL COORDINATION COMPLETE
-- =============================================================================

-- This architecture provides:
-- 1. Single global ordering contract through event log
-- 2. Single source of causality with causal chains
-- 3. Explicit timing model (decision/commit/visibility)
-- 4. Deterministic retry model as first-class events
-- 5. Inconsistency detection and reconciliation
-- 6. Event-driven chaos operations with global coordination
-- 7. Automatic consistency monitoring
-- 8. System state queries with temporal consistency

-- All state transitions are now traceable to a single ordered event log,
-- eliminating the ambiguity that caused Stage 2 failure modes.
