-- hdi_governance.sql — HYDI deterministic state machine + role boundaries
-- Provides the tables and RPCs required by tests/hdi-adversarial.test.js.

-- -----------------------------------------------------------------------------
-- 1. Core state machine tables
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hydi_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT[] NOT NULL DEFAULT '{}',
  current_phase TEXT NOT NULL DEFAULT 'initialized',
  status TEXT NOT NULL DEFAULT 'RUNNING',
  current_actor TEXT,
  findings_count INTEGER NOT NULL DEFAULT 0,
  verification_failed INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hydi_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES hydi_runs(run_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor TEXT,
  from_phase TEXT,
  to_phase TEXT,
  payload JSONB,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

-- -----------------------------------------------------------------------------
-- 2. Role-scoped data tables (cross-role write boundaries enforced by trigger)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hydi_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES hydi_runs(run_id) ON DELETE CASCADE,
  component TEXT,
  severity TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hydi_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES hydi_runs(run_id) ON DELETE CASCADE,
  task_name TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hydi_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES hydi_runs(run_id) ON DELETE CASCADE,
  component TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hydi_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES hydi_runs(run_id) ON DELETE CASCADE,
  certificate_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. Indexes
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_hydi_events_run_id ON hydi_events(run_id);
CREATE INDEX IF NOT EXISTS idx_hydi_events_run_idempotency ON hydi_events(run_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_hydi_findings_run_id ON hydi_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_hydi_tasks_run_id ON hydi_tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_hydi_verifications_run_id ON hydi_verifications(run_id);
CREATE INDEX IF NOT EXISTS idx_hydi_certifications_run_id ON hydi_certifications(run_id);

-- -----------------------------------------------------------------------------
-- 4. Row-level security helpers (service role bypasses RLS, but triggers below
--    enforce role gates for the service role as well)
-- -----------------------------------------------------------------------------

ALTER TABLE hydi_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY hydi_runs_service ON hydi_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY hydi_events_service ON hydi_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY hydi_findings_service ON hydi_findings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY hydi_tasks_service ON hydi_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY hydi_verifications_service ON hydi_verifications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY hydi_certifications_service ON hydi_certifications FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 5. Cross-role write trigger
--    The adversarial test sends X-Client-Info: {"agent_role":"..."} and expects
--    an insufficient_privilege (SQLSTATE 42501) error for disallowed writes.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION hydi_get_request_agent_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = 'public'
AS $$
DECLARE
  raw_headers TEXT;
  client_info TEXT;
  role_val TEXT;
BEGIN
  raw_headers := current_setting('request.headers', true);
  IF raw_headers IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    client_info := (raw_headers::jsonb ->> 'x-client-info');
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  IF client_info IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    role_val := client_info::jsonb ->> 'agent_role';
  EXCEPTION WHEN OTHERS THEN
    -- x-client-info may not be JSON (e.g. default Supabase client string)
    RETURN NULL;
  END;

  RETURN role_val;
END;
$$;

CREATE OR REPLACE FUNCTION hydi_enforce_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  agent_role TEXT;
  allowed_roles TEXT[];
BEGIN
  agent_role := hydi_get_request_agent_role();

  -- If no agent_role is supplied, allow the write (RPCs and maintenance paths).
  IF agent_role IS NULL THEN
    RETURN NEW;
  END IF;

  allowed_roles := CASE TG_TABLE_NAME
    WHEN 'hydi_findings' THEN ARRAY['HEIDI']
    WHEN 'hydi_tasks' THEN ARRAY['EXECUTOR']
    WHEN 'hydi_verifications' THEN ARRAY['KILO']
    WHEN 'hydi_certifications' THEN ARRAY['KILO']
    ELSE ARRAY[]::TEXT[]
  END;

  IF NOT (agent_role = ANY(allowed_roles)) THEN
    RAISE insufficient_privilege USING
      MESSAGE = format('agent_role %s not allowed for %s', agent_role, TG_TABLE_NAME),
      DETAIL = 'Cross-role write rejected';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hydi_findings_role_guard ON hydi_findings;
CREATE TRIGGER hydi_findings_role_guard
  BEFORE INSERT ON hydi_findings
  FOR EACH ROW
  EXECUTE FUNCTION hydi_enforce_role();

DROP TRIGGER IF EXISTS hydi_tasks_role_guard ON hydi_tasks;
CREATE TRIGGER hydi_tasks_role_guard
  BEFORE INSERT ON hydi_tasks
  FOR EACH ROW
  EXECUTE FUNCTION hydi_enforce_role();

DROP TRIGGER IF EXISTS hydi_verifications_role_guard ON hydi_verifications;
CREATE TRIGGER hydi_verifications_role_guard
  BEFORE INSERT ON hydi_verifications
  FOR EACH ROW
  EXECUTE FUNCTION hydi_enforce_role();

DROP TRIGGER IF EXISTS hydi_certifications_role_guard ON hydi_certifications;
CREATE TRIGGER hydi_certifications_role_guard
  BEFORE INSERT ON hydi_certifications
  FOR EACH ROW
  EXECUTE FUNCTION hydi_enforce_role();

-- -----------------------------------------------------------------------------
-- 6. State-machine RPCs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_test_run(
  p_scope TEXT[],
  p_actor TEXT
)
RETURNS TABLE(run_id UUID)
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

  RETURN QUERY SELECT v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_test_run(p_run_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM hydi_certifications WHERE run_id = p_run_id;
  DELETE FROM hydi_verifications WHERE run_id = p_run_id;
  DELETE FROM hydi_tasks WHERE run_id = p_run_id;
  DELETE FROM hydi_findings WHERE run_id = p_run_id;
  DELETE FROM hydi_events WHERE run_id = p_run_id;
  DELETE FROM hydi_runs WHERE run_id = p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION seed_run_phase(p_run_id UUID, p_phase TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE hydi_runs
  SET current_phase = p_phase,
      status = CASE WHEN p_phase IN ('completed', 'failed') THEN 'COMPLETED' ELSE 'RUNNING' END,
      completed_at = CASE WHEN p_phase IN ('completed', 'failed') THEN now() ELSE completed_at END
  WHERE run_id = p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION seed_many_events(p_run_id UUID, p_count INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO hydi_events (run_id, seq, type, payload)
  SELECT p_run_id, s, 'TEST', jsonb_build_object('seed', true)
  FROM generate_series(1, p_count) AS s;
END;
$$;

CREATE OR REPLACE FUNCTION hydi_reconstruct_run(p_run_id UUID)
RETURNS TABLE(current_state JSONB)
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

  RETURN QUERY SELECT jsonb_build_object(
    'run_id', v_run.run_id,
    'scope', v_run.scope,
    'phase', v_run.current_phase,
    'status', v_run.status,
    'current_actor', v_run.current_actor,
    'findings_count', v_run.findings_count,
    'verification_failed', v_run.verification_failed,
    'events', v_events
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Transition RPC
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION hydi_transition(
  p_run_id UUID,
  p_from TEXT,
  p_to TEXT,
  p_payload JSONB,
  p_actor TEXT,
  p_idempotency_key TEXT
)
RETURNS TABLE(success BOOLEAN, event_id UUID, seq INTEGER)
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

  -- 3. Acquire run lock for concurrency safety
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text, 0));

  -- 4. Fetch current run
  SELECT * INTO v_current FROM hydi_runs WHERE hydi_runs.run_id = p_run_id;
  IF v_current.run_id IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_run_id;
  END IF;

  -- 5. Phase must match
  IF v_current.current_phase != p_from THEN
    RAISE EXCEPTION 'Phase mismatch: expected %, got %', p_from, v_current.current_phase;
  END IF;

  -- 6. Idempotency: return existing event for this idempotency key
  SELECT e.event_id INTO v_existing_event_id
  FROM hydi_events e
  WHERE e.run_id = p_run_id AND e.idempotency_key = p_idempotency_key
  LIMIT 1;

  IF v_existing_event_id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_existing_event_id, (SELECT e.seq FROM hydi_events e WHERE e.event_id = v_existing_event_id);
    RETURN;
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

  RETURN QUERY SELECT true, v_new_event_id, v_next_seq;
END;
$$;
