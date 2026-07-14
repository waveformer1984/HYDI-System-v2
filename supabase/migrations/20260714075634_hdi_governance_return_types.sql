-- hdi_governance_return_types.sql — adjust RPC return shapes so the test
-- runner receives plain JSON objects instead of one-row tables.

DROP FUNCTION IF EXISTS create_test_run(TEXT[], TEXT);
CREATE OR REPLACE FUNCTION create_test_run(
  p_scope TEXT[],
  p_actor TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_run_id UUID;
BEGIN
  INSERT INTO hydi_runs (scope, current_actor)
  VALUES (COALESCE(p_scope, '{}'), p_actor)
  RETURNING hydi_runs.run_id INTO v_run_id;

  INSERT INTO hydi_events (run_id, seq, type, actor, to_phase, payload)
  VALUES (v_run_id, 1, 'INITIALIZED', p_actor, 'initialized', jsonb_build_object('scope', p_scope));

  RETURN jsonb_build_object('run_id', v_run_id);
END;
$$;

DROP FUNCTION IF EXISTS hydi_reconstruct_run(UUID);
CREATE OR REPLACE FUNCTION hydi_reconstruct_run(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_run hydi_runs%ROWTYPE;
  v_events JSONB;
BEGIN
  SELECT * INTO v_run FROM hydi_runs WHERE hydi_runs.run_id = p_run_id;

  IF v_run.run_id IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_run_id;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'seq', e.seq,
      'type', e.type,
      'actor', e.actor,
      'from_phase', e.from_phase,
      'to_phase', e.to_phase,
      'payload', e.payload
    ) ORDER BY e.seq
  ), '[]'::jsonb)
  INTO v_events
  FROM hydi_events e
  WHERE e.run_id = p_run_id;

  RETURN jsonb_build_object(
    'current_state', jsonb_build_object(
      'run_id', v_run.run_id,
      'scope', v_run.scope,
      'phase', v_run.current_phase,
      'status', v_run.status,
      'current_actor', v_run.current_actor,
      'findings_count', v_run.findings_count,
      'verification_failed', v_run.verification_failed,
      'events', v_events
    )
  );
END;
$$;

DROP FUNCTION IF EXISTS hydi_transition(UUID, TEXT, TEXT, JSONB, TEXT, TEXT);
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

  IF v_allowed_actor_transitions ? p_actor THEN
    v_actor_allowed := (p_to = ANY(ARRAY(SELECT jsonb_array_elements_text(v_allowed_actor_transitions -> p_actor))));
  END IF;

  IF NOT v_actor_allowed THEN
    RAISE EXCEPTION 'Actor % not allowed to transition to %', p_actor, p_to;
  END IF;

  IF v_allowed_transitions ? p_from THEN
    v_from_allowed := (p_to = ANY(ARRAY(SELECT jsonb_array_elements_text(v_allowed_transitions -> p_from))));
  END IF;

  IF NOT v_from_allowed THEN
    RAISE EXCEPTION 'Transition from % to % not allowed', p_from, p_to;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text, 0));

  SELECT * INTO v_current FROM hydi_runs WHERE hydi_runs.run_id = p_run_id;
  IF v_current.run_id IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_run_id;
  END IF;

  IF v_current.current_phase != p_from THEN
    RAISE EXCEPTION 'Phase mismatch: expected %, got %', p_from, v_current.current_phase;
  END IF;

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

  SELECT COALESCE(MAX(e.seq), 0) + 1 INTO v_next_seq
  FROM hydi_events e
  WHERE e.run_id = p_run_id;

  INSERT INTO hydi_events (run_id, seq, type, actor, from_phase, to_phase, payload, idempotency_key)
  VALUES (p_run_id, v_next_seq, 'PHASE_TRANSITION', p_actor, p_from, p_to, COALESCE(p_payload, '{}'::jsonb), p_idempotency_key)
  RETURNING hydi_events.event_id INTO v_new_event_id;

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
