-- HYDI Chaos + Safety Schema Migration
-- Version: 2.1.0
-- Description: Adds chaos testing harness, side-effect ledger, replay integrity checks, and agent lease system

-- =============================================================================
-- 1) EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 2) CHAOS RUN CONFIGURATION + STATUS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.chaos_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  seed bigint NOT NULL,
  total_runs int NOT NULL CHECK (total_runs > 0),
  concurrency int NOT NULL CHECK (concurrency > 0),
  failure_rate numeric NOT NULL CHECK (failure_rate >= 0 AND failure_rate <= 1),
  duplicate_event_rate numeric NOT NULL CHECK (duplicate_event_rate >= 0 AND duplicate_event_rate <= 1),
  stall_probability numeric NOT NULL CHECK (stall_probability >= 0 AND stall_probability <= 1),
  latency_profile_ms int[] NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','aborted')),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.chaos_runs IS 'Configuration and status for chaos test runs';

-- =============================================================================
-- 3) PER-RUN INSTANCE EXECUTION TRACKING
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.chaos_run_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chaos_run_id uuid NOT NULL REFERENCES public.chaos_runs(id) ON DELETE CASCADE,
  scenario_key text NOT NULL, -- e.g. run-0001
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','error','dead_letter')),
  attempt_count int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chaos_run_id, scenario_key)
);

COMMENT ON TABLE public.chaos_run_instances IS 'Individual run instances within a chaos test';

-- =============================================================================
-- 4) INJECTED FAULT EVENTS FOR OBSERVABILITY/REPLAY DIAGNOSIS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.chaos_fault_injections (
  id bigserial PRIMARY KEY,
  chaos_run_id uuid NOT NULL REFERENCES public.chaos_runs(id) ON DELETE CASCADE,
  instance_id uuid REFERENCES public.chaos_run_instances(id) ON DELETE CASCADE,
  fault_type text NOT NULL CHECK (fault_type IN ('latency','duplicate','stall','forced_error','drop')),
  phase text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.chaos_fault_injections IS 'Record of all faults injected during chaos tests';

-- =============================================================================
-- 5) SIDE-EFFECT LEDGER (IDEMPOTENCY + REPLAY SAFETY)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.side_effect_ledger (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  phase text NOT NULL,
  effect_type text NOT NULL, -- stripe_charge, webhook_send, email_send, etc
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb,
  status text NOT NULL CHECK (status IN ('pending','succeeded','failed','compensated')),
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (effect_type, idempotency_key)
);

COMMENT ON TABLE public.side_effect_ledger IS 'Tracks all external side effects for idempotency and replay safety';

-- =============================================================================
-- 6) REPLAY INTEGRITY RECORDS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.replay_integrity_checks (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  source_schema_version text NOT NULL,
  target_schema_version text NOT NULL,
  expected_terminal_hash text NOT NULL,
  reconstructed_terminal_hash text NOT NULL,
  match boolean GENERATED ALWAYS AS (expected_terminal_hash = reconstructed_terminal_hash) STORED,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.replay_integrity_checks IS 'Validates replay fidelity by comparing terminal state hashes';

-- =============================================================================
-- 7) AGENT LEASE OWNERSHIP (SINGLE ACTIVE OWNER)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agent_leases (
  run_id uuid NOT NULL,
  phase text NOT NULL,
  lease_owner text NOT NULL, -- agent id
  lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
  lease_expires_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, phase)
);

COMMENT ON TABLE public.agent_leases IS 'Tracks which agent owns a lease for each run+phase';

-- =============================================================================
-- 8) HELPFUL INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_chaos_instances_state ON public.chaos_run_instances(chaos_run_id, state);
CREATE INDEX IF NOT EXISTS idx_ledger_run_phase ON public.side_effect_ledger(run_id, phase);
CREATE INDEX IF NOT EXISTS idx_ledger_idempotency ON public.side_effect_ledger(effect_type, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_replay_match ON public.replay_integrity_checks(run_id, match);
CREATE INDEX IF NOT EXISTS idx_leases_expiry ON public.agent_leases(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_leases_owner ON public.agent_leases(lease_owner);

-- =============================================================================
-- 9) CORE INVARIANT HELPERS
-- =============================================================================

-- Transition audit failures: raise immediately on impossible state
CREATE OR REPLACE FUNCTION public.assert_invariants(
  p_phase text,
  p_status text,
  p_findings_count int,
  p_verification_failed int
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_phase = 'VERIFY' AND coalesce(p_findings_count,0) = 0 THEN
    RAISE EXCEPTION 'Invariant violation: VERIFY requires findings > 0';
  END IF;

  IF p_status = 'COMPLETED' AND coalesce(p_verification_failed,0) > 0 THEN
    RAISE EXCEPTION 'Invariant violation: COMPLETED cannot have verification failures';
  END IF;
  
  IF p_phase = 'EXECUTE' AND coalesce(p_findings_count,0) = 0 THEN
    RAISE EXCEPTION 'Invariant violation: EXECUTE requires findings > 0';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_invariants IS 'Validates state invariants before transitions';

-- =============================================================================
-- 10) LEASE ACQUIRE / RENEW / TAKEOVER
-- =============================================================================

CREATE OR REPLACE FUNCTION public.acquire_or_takeover_lease(
  p_run_id uuid,
  p_phase text,
  p_agent text,
  p_ttl_seconds int DEFAULT 30
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
  v_new_token uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.agent_leases(run_id, phase, lease_owner, lease_token, lease_expires_at, heartbeat_at)
  VALUES (p_run_id, p_phase, p_agent, v_new_token, v_now + make_interval(secs => p_ttl_seconds), v_now)
  ON CONFLICT (run_id, phase) DO UPDATE
  SET
    lease_owner = CASE
      WHEN public.agent_leases.lease_expires_at < v_now THEN EXCLUDED.lease_owner
      WHEN public.agent_leases.lease_owner = p_agent THEN EXCLUDED.lease_owner
      ELSE public.agent_leases.lease_owner
    END,
    lease_token = CASE
      WHEN public.agent_leases.lease_expires_at < v_now THEN EXCLUDED.lease_token
      WHEN public.agent_leases.lease_owner = p_agent THEN EXCLUDED.lease_token
      ELSE public.agent_leases.lease_token
    END,
    lease_expires_at = CASE
      WHEN public.agent_leases.lease_expires_at < v_now THEN EXCLUDED.lease_expires_at
      WHEN public.agent_leases.lease_owner = p_agent THEN EXCLUDED.lease_expires_at
      ELSE public.agent_leases.lease_expires_at
    END,
    heartbeat_at = CASE
      WHEN public.agent_leases.lease_expires_at < v_now THEN EXCLUDED.heartbeat_at
      WHEN public.agent_leases.lease_owner = p_agent THEN EXCLUDED.heartbeat_at
      ELSE public.agent_leases.heartbeat_at
    END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_leases
    WHERE run_id = p_run_id
      AND phase = p_phase
      AND lease_owner = p_agent
      AND lease_token = v_new_token
  ) THEN
    RAISE EXCEPTION 'Lease held by another active owner';
  END IF;

  RETURN v_new_token;
END;
$$;

COMMENT ON FUNCTION public.acquire_or_takeover_lease IS 'Acquires or takes over agent lease with expiration logic';

-- =============================================================================
-- 11) HEARTBEAT FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.heartbeat_lease(
  p_run_id uuid,
  p_phase text,
  p_agent text,
  p_token uuid,
  p_ttl_seconds int DEFAULT 30
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE public.agent_leases
  SET 
    lease_expires_at = v_now + make_interval(secs => p_ttl_seconds),
    heartbeat_at = v_now
  WHERE run_id = p_run_id
    AND phase = p_phase
    AND lease_owner = p_agent
    AND lease_token = p_token
    AND lease_expires_at > v_now;
    
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.heartbeat_lease IS 'Renews agent lease with heartbeat';

-- =============================================================================
-- 12) FORCE RELEASE (URSULA/ESCALATION PATH)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.force_release_lease(
  p_run_id uuid,
  p_phase text,
  p_reason text DEFAULT 'escalation'
) RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.agent_leases
  WHERE run_id = p_run_id
    AND phase = p_phase;
    
  -- Log the forced release
  INSERT INTO public.chaos_fault_injections (
    chaos_run_id, instance_id, fault_type, phase, payload
  ) VALUES (
    NULL, NULL, 'forced_error', p_phase, 
    jsonb_build_object('action', 'force_release', 'reason', p_reason, 'run_id', p_run_id)
  );
    
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.force_release_lease IS 'Forcibly releases a lease (Ursula escalation)';

-- =============================================================================
-- 13) SIDE EFFECT IDEMPOTENCY CHECK
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_side_effect_exists(
  p_effect_type text,
  p_idempotency_key text
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.side_effect_ledger
    WHERE effect_type = p_effect_type
      AND idempotency_key = p_idempotency_key
      AND status = 'succeeded'
  ) INTO v_exists;
  
  RETURN v_exists;
END;
$$;

COMMENT ON FUNCTION public.check_side_effect_exists IS 'Checks if a side effect has already been completed';

-- =============================================================================
-- 14) RECORD SIDE EFFECT
-- =============================================================================

CREATE OR REPLACE FUNCTION public.record_side_effect(
  p_run_id uuid,
  p_phase text,
  p_effect_type text,
  p_idempotency_key text,
  p_request_payload jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.side_effect_ledger (
    run_id, phase, effect_type, idempotency_key, request_payload, status
  ) VALUES (
    p_run_id, p_phase, p_effect_type, p_idempotency_key, p_request_payload, 'pending'
  )
  ON CONFLICT (effect_type, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  
  RETURN coalesce(v_id, 0);
END;
$$;

COMMENT ON FUNCTION public.record_side_effect IS 'Records a new side effect or returns 0 if already exists';

-- =============================================================================
-- 15) UPDATE SIDE EFFECT STATUS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_side_effect_status(
  p_id bigint,
  p_status text,
  p_response_payload jsonb DEFAULT NULL,
  p_error_text text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.side_effect_ledger
  SET 
    status = p_status,
    response_payload = coalesce(p_response_payload, response_payload),
    error_text = coalesce(p_error_text, error_text),
    updated_at = now()
  WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.update_side_effect_status IS 'Updates side effect status after completion/failure';

-- =============================================================================
-- 16) REPLAY FIDELITY CHECK
-- =============================================================================

CREATE OR REPLACE FUNCTION public.record_replay_integrity(
  p_run_id uuid,
  p_source_version text,
  p_target_version text,
  p_expected_hash text,
  p_reconstructed_hash text,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.replay_integrity_checks (
    run_id, source_schema_version, target_schema_version,
    expected_terminal_hash, reconstructed_terminal_hash, details
  ) VALUES (
    p_run_id, p_source_version, p_target_version,
    p_expected_hash, p_reconstructed_hash, p_details
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_replay_integrity IS 'Records replay fidelity check result';

-- =============================================================================
-- 17) TRIGGER: UPDATED_AT AUTOMATIC UPDATE
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chaos_run_instances_updated_at
  BEFORE UPDATE ON public.chaos_run_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER side_effect_ledger_updated_at
  BEFORE UPDATE ON public.side_effect_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 18) RLS POLICIES (Service role only for safety tables)
-- =============================================================================

ALTER TABLE public.chaos_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaos_run_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaos_fault_injections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.side_effect_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replay_integrity_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_leases ENABLE ROW LEVEL SECURITY;

-- Service role has full access (Edge Functions)
CREATE POLICY service_role_chaos_runs ON public.chaos_runs
  FOR ALL USING (current_user = 'supabase_functions_admin');

CREATE POLICY service_role_chaos_instances ON public.chaos_run_instances
  FOR ALL USING (current_user = 'supabase_functions_admin');

CREATE POLICY service_role_faults ON public.chaos_fault_injections
  FOR ALL USING (current_user = 'supabase_functions_admin');

CREATE POLICY service_role_ledger ON public.side_effect_ledger
  FOR ALL USING (current_user = 'supabase_functions_admin');

CREATE POLICY service_role_replay ON public.replay_integrity_checks
  FOR ALL USING (current_user = 'supabase_functions_admin');

CREATE POLICY service_role_leases ON public.agent_leases
  FOR ALL USING (current_user = 'supabase_functions_admin');

-- Read-only for authenticated users (observability)
CREATE POLICY readonly_chaos_runs ON public.chaos_runs
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY readonly_chaos_instances ON public.chaos_run_instances
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY readonly_replay ON public.replay_integrity_checks
  FOR SELECT USING (auth.role() = 'authenticated');

-- =============================================================================
-- 19) SEED CHAOS PROFILE
-- =============================================================================

INSERT INTO public.chaos_runs (
  name, seed, total_runs, concurrency, failure_rate, duplicate_event_rate, 
  stall_probability, latency_profile_ms, status
) VALUES (
  'HYDI v2.1.0 Baseline Chaos Test',
  123456789, -- deterministic seed
  100,       -- total runs
  20,        -- concurrency
  0.15,      -- 15% failure rate
  0.10,      -- 10% duplicate event rate
  0.05,      -- 5% stall probability
  ARRAY[50, 500, 2000], -- latency profile
  'pending'
)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
