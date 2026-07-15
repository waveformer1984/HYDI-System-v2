-- ============================================================================
-- LOCAL BASELINE: core objects that existed only in the (now-dead) cloud
-- project and were never captured in migrations.
--
-- The cloud Supabase projects are unreachable (NXDOMAIN, 2026-07-07). These
-- objects were reconstructed from the repo's own SQL fragments and code usage:
--   memories/actions/sessions      <- supabase/heidi-init.sql
--   search_memories()              <- heidi-memory-schema.sql (ambiguity fixed)
--   leads/outreach/proposals/quotes/checkout_sessions/product_*/task_queue
--                                  <- revenue-engine/schema.sql
--   worker_jobs/worker_failures    <- reconstructed from enhanced-worker-
--                                     orchestrator.js + cascade-hardening.sql
--   retry_failed_jobs/flag_dead_jobs <- cascade-hardening.sql
--   system_health_runs             <- create-system-health-table.sql
--   analyze_health_trends/evaluate_system_escalation/auto_heal_from_trends,
--   system_dashboard view          <- trend-analysis-auto-response.sql
--
-- pg_cron scheduling from those files is intentionally OMITTED here: the
-- schedules are an operational concern, not schema, and cron is not needed
-- for the health/dashboard read paths.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. HEIDI memory layer: memories / actions / sessions
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  session_id text NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text,
  task_name text,
  status text CHECK (status IN ('pending','completed','failed')),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
  session_id text PRIMARY KEY,
  tone text,
  active_model text,
  last_action_status text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Server code uses the service role (BYPASSRLS). These policies only govern
-- direct authenticated-user access.
DROP POLICY IF EXISTS "user_memory_access" ON public.memories;
CREATE POLICY "user_memory_access" ON public.memories
  FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_memories_session ON public.memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_user    ON public.memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_created ON public.memories(created_at);
CREATE INDEX IF NOT EXISTS idx_actions_session  ON public.actions(session_id);
CREATE INDEX IF NOT EXISTS idx_actions_status   ON public.actions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON public.sessions(updated_at);

-- ivfflat needs rows to build useful lists; fine to create empty.
CREATE INDEX IF NOT EXISTS idx_memories_embedding
  ON public.memories USING ivfflat (embedding vector_cosine_ops);

-- Called by lib/heidi-memory.ts via supabase.rpc('search_memories', {...}).
-- Parameter names must stay exactly query_embedding/match_count/user_id for
-- PostgREST named-argument dispatch. Body qualifies the parameter to avoid
-- the column/parameter ambiguity the original fragment had.
CREATE OR REPLACE FUNCTION public.search_memories(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  user_id text DEFAULT NULL
)
-- NOTE: no user_id output column — it would collide with the user_id
-- parameter name in plpgsql (SQLSTATE 42P13). Callers only consume content.
RETURNS TABLE (
  id uuid,
  session_id text,
  content text,
  created_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.session_id,
    m.content,
    m.created_at,
    1 - (m.embedding <=> search_memories.query_embedding) AS similarity
  FROM public.memories m
  WHERE
    (search_memories.user_id IS NULL OR m.user_id = search_memories.user_id)
    AND m.embedding IS NOT NULL
  ORDER BY m.embedding <=> search_memories.query_embedding
  LIMIT search_memories.match_count;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Revenue pipeline: leads / outreach / proposals / quotes /
--    checkout_sessions / product_ideas / product_listings / task_queue
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.leads (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    contact TEXT,
    niche TEXT,
    source TEXT,
    score INTEGER DEFAULT 0,
    status TEXT DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    contacted_at TIMESTAMPTZ,
    converted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.outreach (
    id TEXT PRIMARY KEY,
    lead_id TEXT REFERENCES public.leads(id),
    email_subject TEXT,
    email_body TEXT,
    status TEXT DEFAULT 'sent',
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    response_type TEXT
);

CREATE TABLE IF NOT EXISTS public.proposals (
    id TEXT PRIMARY KEY,
    lead_id TEXT REFERENCES public.leads(id),
    project_type TEXT,
    title TEXT,
    description TEXT,
    pricing JSONB,
    timeline TEXT,
    deliverables JSONB,
    status TEXT DEFAULT 'generated',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.quotes (
    id TEXT PRIMARY KEY,
    project_type TEXT,
    quantity INTEGER,
    complexity TEXT,
    rush_order BOOLEAN DEFAULT FALSE,
    base_price DECIMAL(10,2),
    unit_price DECIMAL(10,2),
    total DECIMAL(10,2),
    currency TEXT DEFAULT 'usd',
    valid_until TIMESTAMPTZ,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.checkout_sessions (
    id TEXT PRIMARY KEY,
    quote_id TEXT REFERENCES public.quotes(id),
    stripe_session_id TEXT,
    amount DECIMAL(10,2),
    currency TEXT,
    status TEXT DEFAULT 'pending',
    customer_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.product_ideas (
    id TEXT PRIMARY KEY,
    name TEXT,
    category TEXT,
    description TEXT,
    estimated_cost DECIMAL(10,2),
    estimated_price DECIMAL(10,2),
    trend_score INTEGER,
    status TEXT DEFAULT 'idea',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_listings (
    id TEXT PRIMARY KEY,
    product_idea_id TEXT REFERENCES public.product_ideas(id),
    platform TEXT,
    title TEXT,
    description TEXT,
    price DECIMAL(10,2),
    tags JSONB,
    images JSONB,
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.task_queue (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    task_type TEXT,
    description TEXT,
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'normal',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    result JSONB
);

-- RLS on with no anon/authenticated policies: fail-closed for public keys,
-- service role bypasses. Matches how the server code accesses these tables.
ALTER TABLE public.leads             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_ideas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_listings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_queue        ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_score ON public.leads(score DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_lead_id ON public.outreach(lead_id);
CREATE INDEX IF NOT EXISTS idx_proposals_lead_id ON public.proposals(lead_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_status ON public.checkout_sessions(status);
CREATE INDEX IF NOT EXISTS idx_product_ideas_status ON public.product_ideas(status);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Worker queue: worker_jobs / worker_failures (+ retry/flag functions)
--    Columns reconstructed from enhanced-worker-orchestrator.js usage.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.worker_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_name text NOT NULL DEFAULT 'default',
    job_type text,
    status text NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued','processing','done','failed','dead')),
    priority integer NOT NULL DEFAULT 0,
    payload jsonb,
    result jsonb,
    error_message text,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    correlation_id uuid,
    locked_by text,
    lease_expires_at timestamptz,
    available_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.worker_failures (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid REFERENCES public.worker_jobs(id) ON DELETE CASCADE,
    attempts integer NOT NULL DEFAULT 0,
    error_message text,
    failed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_failures ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS worker_jobs_status_created_at_idx
  ON public.worker_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS worker_jobs_priority_idx
  ON public.worker_jobs (priority DESC, created_at);
CREATE INDEX IF NOT EXISTS worker_jobs_queue_claim_idx
  ON public.worker_jobs (queue_name, status, available_at);

CREATE OR REPLACE FUNCTION public.retry_failed_jobs()
RETURNS TABLE(retried_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_retried bigint := 0;
BEGIN
    UPDATE worker_jobs
    SET status = 'queued',
        attempts = attempts + 1,
        error_message = NULL,
        available_at = NOW() + (attempts * 30) * INTERVAL '1 second',
        updated_at = NOW()
    WHERE id IN (
        SELECT job_id FROM worker_failures
        WHERE failed_at > NOW() - INTERVAL '1 hour'
        AND attempts < 3
    );

    GET DIAGNOSTICS v_retried = ROW_COUNT;

    DELETE FROM worker_failures
    WHERE job_id IN (
        SELECT id FROM worker_jobs WHERE status = 'queued'
    );

    retried_count := v_retried;
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.flag_dead_jobs()
RETURNS TABLE(flagged_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_flagged bigint := 0;
BEGIN
    UPDATE worker_jobs
    SET status = 'dead',
        updated_at = NOW()
    WHERE status = 'processing'
      AND updated_at < NOW() - INTERVAL '15 minutes';

    GET DIAGNOSTICS v_flagged = ROW_COUNT;

    flagged_count := v_flagged;
    RETURN NEXT;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3b. event_bus_events: the migrated table has event_type/created_at, but all
--     the code (enhanced-worker-orchestrator.js, trend functions, dashboard)
--     writes/reads topic/event_name/occurred_at/source_worker/correlation_id
--     — the shape the cloud table actually had. Add those columns additively.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.event_bus_events ADD COLUMN IF NOT EXISTS topic text;
ALTER TABLE public.event_bus_events ADD COLUMN IF NOT EXISTS event_name text;
ALTER TABLE public.event_bus_events ADD COLUMN IF NOT EXISTS source_worker text;
ALTER TABLE public.event_bus_events ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE public.event_bus_events ADD COLUMN IF NOT EXISTS occurred_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_event_bus_events_topic_occurred
  ON public.event_bus_events (topic, occurred_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Health: system_health_runs + trend/escalation/auto-heal functions
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.system_health_runs (
    id SERIAL PRIMARY KEY,
    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('OK', 'WARNING', 'CRITICAL')),
    environment TEXT DEFAULT 'production',
    queue_status TEXT,
    event_flow_status TEXT,
    revenue_status TEXT,
    automation_status TEXT,
    entitlements_status TEXT,
    issues_count INTEGER DEFAULT 0,
    warnings_count INTEGER DEFAULT 0,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_runs_run_at ON public.system_health_runs(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_runs_status ON public.system_health_runs(status);

ALTER TABLE public.system_health_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage health runs" ON public.system_health_runs;
CREATE POLICY "Service role can manage health runs"
    ON public.system_health_runs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.analyze_health_trends()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_total INT := 0;
  v_critical_count INT := 0;
  v_warning_count INT := 0;
  v_avg_queue NUMERIC := 0;
  v_fail_rate NUMERIC := 0;
  v_status TEXT := 'stable';
  v_reason TEXT := 'System nominal';
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status = 'CRITICAL') AS critical_ct,
    COUNT(*) FILTER (WHERE status = 'WARNING') AS warning_ct,
    COUNT(*) AS total_ct,
    AVG(COALESCE((details->'components'->'queue'->>'queued')::int, 0)) AS avg_q,
    AVG(COALESCE((details->'components'->'queue'->>'failed')::numeric, 0) /
        NULLIF(COALESCE((details->'components'->'queue'->>'total')::numeric, 0), 0)) AS fail_trend
  INTO v_critical_count, v_warning_count, v_total, v_avg_queue, v_fail_rate
  FROM (
    SELECT status, details
    FROM system_health_runs
    ORDER BY run_at DESC
    LIMIT 20
  ) sub;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'status', 'unknown',
      'reason', 'No health runs found',
      'metrics', jsonb_build_object(
        'total_runs', 0, 'critical_pct', 0, 'warning_pct', 0,
        'avg_queue_size', 0, 'failure_rate_pct', 0
      )
    );
  END IF;

  IF (v_critical_count::numeric / v_total) >= 0.3 THEN
    v_status := 'critical_trend';
    v_reason := format('%s%% of last %s runs were CRITICAL',
      round((v_critical_count::numeric/v_total)*100), v_total);
  ELSIF (v_warning_count::numeric / v_total) >= 0.5 THEN
    v_status := 'degrading';
    v_reason := format('WARNING in %s%% of recent runs, avg queue: %s',
      round((v_warning_count::numeric/v_total)*100), round(v_avg_queue));
  ELSE
    v_status := 'stable';
    v_reason := format('System stable across %s runs', v_total);
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'reason', v_reason,
    'metrics', jsonb_build_object(
      'total_runs', v_total,
      'critical_pct', round((v_critical_count::numeric / v_total) * 100),
      'warning_pct', round((v_warning_count::numeric / v_total) * 100),
      'avg_queue_size', round(v_avg_queue),
      'failure_rate_pct', round(COALESCE(v_fail_rate, 0) * 100, 2)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_system_escalation()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_critical_recent INT;
  v_warning_start TIMESTAMPTZ;
  v_warning_duration_min NUMERIC;
  v_action TEXT := 'none';
  v_reason TEXT := 'System stable';
  v_level TEXT := 'OK';
BEGIN
  SELECT COUNT(*) INTO v_critical_recent
  FROM (
    SELECT status FROM system_health_runs
    ORDER BY run_at DESC LIMIT 10
  ) sub
  WHERE status = 'CRITICAL';

  IF v_critical_recent >= 3 THEN
    v_level := 'CRITICAL';
    v_action := 'immediate_escalation';
    v_reason := format('%s CRITICAL states in last 10 runs', v_critical_recent);
  ELSE
    SELECT MIN(run_at) INTO v_warning_start
    FROM (
      SELECT run_at, status
      FROM system_health_runs
      ORDER BY run_at DESC LIMIT 20
    ) sub
    WHERE status = 'WARNING';

    IF v_warning_start IS NOT NULL THEN
      v_warning_duration_min :=
        EXTRACT(EPOCH FROM (NOW() - v_warning_start)) / 60;

      IF v_warning_duration_min > 15 THEN
        v_level := 'WARNING';
        v_action := 'warning_escalation';
        v_reason := format('WARNING persisting for %s minutes',
          round(v_warning_duration_min));
      END IF;
    END IF;
  END IF;

  IF v_action != 'none' THEN
    INSERT INTO event_bus_events (topic, event_name, payload, occurred_at)
    VALUES (
      'system:escalation',
      'escalation_' || LOWER(v_level),
      jsonb_build_object(
        'level', v_level,
        'action', v_action,
        'reason', v_reason,
        'evaluated_at', NOW()
      ),
      NOW()
    );
  END IF;

  RETURN jsonb_build_object(
    'level', v_level,
    'action', v_action,
    'reason', v_reason,
    'critical_in_last_10', v_critical_recent
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_heal_from_trends()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_trends jsonb;
  v_escalation jsonb;
  v_healed INT := 0;
  v_actions jsonb[] := ARRAY[]::jsonb[];
BEGIN
  v_trends := analyze_health_trends();
  v_escalation := evaluate_system_escalation();

  IF (v_trends->>'status') IN ('degrading', 'critical_trend') THEN
    PERFORM retry_failed_jobs();
    v_healed := v_healed + 1;
    v_actions := v_actions || jsonb_build_object(
      'action', 'retry_failed_jobs',
      'reason', 'Trend status: ' || (v_trends->>'status')
    );
  END IF;

  IF (v_trends->>'status') = 'critical_trend' THEN
    PERFORM flag_dead_jobs();
    v_healed := v_healed + 1;
    v_actions := v_actions || jsonb_build_object(
      'action', 'flag_dead_jobs',
      'reason', 'Critical trend detected'
    );
  END IF;

  IF v_healed > 0 THEN
    INSERT INTO event_bus_events (topic, event_name, payload, occurred_at)
    VALUES (
      'system:auto_heal',
      'auto_heal_executed',
      jsonb_build_object(
        'actions_taken', v_healed,
        'actions', to_jsonb(v_actions),
        'trend_status', v_trends->>'status',
        'escalation_level', v_escalation->>'level',
        'healed_at', NOW()
      ),
      NOW()
    );
  END IF;

  RETURN jsonb_build_object(
    'healed', v_healed,
    'actions', to_jsonb(v_actions),
    'trend', v_trends,
    'escalation', v_escalation
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. system_dashboard view — single row, shape matches api/health.js exactly.
--    Deliberately NOT security_invoker: api/local-model.js reads it with the
--    anon key and it exposes only aggregate operational counters.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.system_dashboard AS
SELECT
  (SELECT status FROM system_health_runs
   ORDER BY run_at DESC LIMIT 1) AS current_status,
  (SELECT run_at FROM system_health_runs
   ORDER BY run_at DESC LIMIT 1) AS last_check,

  (analyze_health_trends()->>'status') AS trend_status,
  (analyze_health_trends()->>'reason') AS trend_reason,
  (analyze_health_trends()->'metrics'->>'critical_pct')::int AS critical_pct,
  (analyze_health_trends()->'metrics'->>'warning_pct')::int AS warning_pct,
  (analyze_health_trends()->'metrics'->>'avg_queue_size')::int AS avg_queue_size,

  (evaluate_system_escalation()->>'level') AS escalation_level,
  (evaluate_system_escalation()->>'action') AS escalation_action,
  (evaluate_system_escalation()->>'reason') AS escalation_reason,

  (SELECT COUNT(*) FROM worker_jobs WHERE status = 'queued') AS jobs_queued,
  (SELECT COUNT(*) FROM worker_jobs WHERE status = 'failed') AS jobs_failed,
  (SELECT COUNT(*) FROM worker_jobs WHERE status = 'dead') AS jobs_dead,

  (SELECT COUNT(*) FROM event_bus_events
   WHERE occurred_at > NOW() - INTERVAL '1 hour') AS events_last_hour,

  (SELECT COUNT(*) FROM event_bus_events
   WHERE topic = 'system:auto_heal'
   AND occurred_at > NOW() - INTERVAL '24 hours') AS auto_heals_24h,

  NOW() AS dashboard_generated_at;
