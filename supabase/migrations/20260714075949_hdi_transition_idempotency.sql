-- hdi_transition_idempotency.sql — move idempotency check before phase match
-- so that duplicate requests with the same idempotency key return the existing
-- event even when the run has already moved past the source phase.

CREATE OR REPLACE FUNCTION hydi_transition(
  p_run_id UUID,
  p_from TEXT,
  p_to TEXT,
  p_payload JSONB,
  p_actor TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_allowed_actor_transitions JSONB;
  v_allowed_transitions JSONB;
  v_actor_allowed BOOLEAN := false;
  v_from_allowed BOOLEAN := false;
  v_current hydi_runs%ROWTYPE;
  v_existing_event_id UUID;
  v_next_seq INTEGER;
  v_new_event_id UUID;
BEGIN
  v_allowed_actor_transitions := jsonb_build_object(
    'ursula', jsonb_build_array('initialized', 'audit'),
    'auditor', jsonb_build_array('audit', 'execute', 'failed'),
    'executor', jsonb_build_array('execute', 'verify', 'reopen_audit', 'failed'),
    'verifier', jsonb_build_array('verify', 'completed', 'reopen_audit', 'failed')
  );

  v_allowed_transitions := jsonb_build_object(
    'initialized', jsonb_build_array('audit'),
    'audit', jsonb_build_array('execute', 'failed'),
    'execute', jsonb_build_array('verify', 'reopen_audit', 'failed'),
    'verify', jsonb_build_array('completed', 'reopen_audit', 'failed'),
    'reopen_audit', jsonb_build_array('audit')
  );

  -- 1. Actor permission
  IF v_allowed_actor_transitions ? p_actor THEN
    v_actor_allowed := (p_to = ANY(ARRAY(SELECT jsonb_array_elements_text(v_allowed_actor_transitions -> p_actor))));
  END IF;

  IF NOT v_actor_allowed THEN
    RAISE EXCEPTION 'Actor % not allowed to transition to %', p_actor, p_to;
  END IF;

  -- 2. Allowed transition
  IF v_allowed_transitions ? p_from THEN
    v_from_allowed := (p_to = ANY(ARRAY(SELECT jsonb_array_elements_text(v_allowed_transitions -> p_from))));
  END IF;

  IF NOT v_from_allowed THEN
    RAISE EXCEPTION 'Transition from % to % not allowed', p_from, p_to;
  END IF;

  -- 3. Acquire run lock
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text, 0));

  -- 4. Fetch current run
  SELECT * INTO v_current FROM hydi_runs WHERE hydi_runs.run_id = p_run_id;
  IF v_current.run_id IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_run_id;
  END IF;

  -- 5. Idempotency: return existing event for this key before phase match
  SELECT e.event_id INTO v_existing_event_id
  FROM hydi_events e
  WHERE e.run_id = p_run_id AND e.idempotency_key = p_idempotency_key
  LIMIT 1;

  IF v_existing_event_id IS NOT NULL THEN
    RETURN (
      SELECT jsonb_build_object(
        'success', true,
        'event_id', e.event_id,
        'seq', e.seq,
        'idempotent', true
      )
      FROM hydi_events e
      WHERE e.event_id = v_existing_event_id
    );
  END IF;

  -- 6. Phase must match
  IF v_current.current_phase != p_from THEN
    RAISE EXCEPTION 'Phase mismatch: expected %, got %', p_from, v_current.current_phase;
  END IF;

  -- 7. Next sequence
  SELECT COALESCE(MAX(e.seq), 0) + 1 INTO v_next_seq
  FROM hydi_events e
  WHERE e.run_id = p_run_id;

  -- 8. Insert event
  INSERT INTO hydi_events (run_id, seq, type, actor, from_phase, to_phase, payload, idempotency_key)
  VALUES (p_run_id, v_next_seq, 'PHASE_TRANSITION', p_actor, p_from, p_to, COALESCE(p_payload, '{}'::jsonb), p_idempotency_key)
  RETURNING hydi_events.event_id INTO v_new_event_id;

  -- 9. Update run state
  UPDATE hydi_runs
  SET
    current_phase = p_to,
    current_actor = p_actor,
    status = CASE WHEN p_to IN ('completed', 'failed') THEN 'COMPLETED' ELSE 'RUNNING' END,
    completed_at = CASE WHEN p_to IN ('completed', 'failed') THEN now() ELSE completed_at END,
    findings_count = GREATEST(0, COALESCE((p_payload ->> 'findings')::integer, v_current.findings_count)),
    verification_failed = GREATEST(0, COALESCE((p_payload ->> 'failed')::integer, v_current.verification_failed))
  WHERE hydi_runs.run_id = p_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_new_event_id,
    'seq', v_next_seq
  );
END;
$$;
