-- Fix Chaos Monitoring (Run in Supabase Dashboard SQL Editor)
-- Creates missing functions and tests with proper base table inserts

-- =============================================================================
-- CREATE MISSING FUNCTIONS
-- =============================================================================

-- Health Check Function
CREATE OR REPLACE FUNCTION public.active_chaos_alerts_count()
RETURNS TABLE(
  critical_count bigint,
  high_count bigint,
  medium_count bigint,
  low_count bigint,
  total_count bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*) FILTER (WHERE severity = 'critical')::bigint AS critical_count,
    COUNT(*) FILTER (WHERE severity = 'high')::bigint AS high_count,
    COUNT(*) FILTER (WHERE severity = 'medium')::bigint AS medium_count,
    COUNT(*) FILTER (WHERE severity = 'low')::bigint AS low_count,
    COUNT(*)::bigint AS total_count
  FROM public.chaos_alerts
  WHERE requires_action = true;
$$;

-- Deployment Gate Function
CREATE OR REPLACE FUNCTION public.chaos_gate_check()
RETURNS TABLE(
  gate_passed boolean,
  failure_reason text,
  recent_runs_count bigint,
  success_rate numeric,
  critical_failures bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH recent_runs AS (
    SELECT 
      verdict,
      passed_ratio,
      CASE 
        WHEN replay_mismatches > 0 OR duplicate_effect_pairs > 0 THEN true 
        ELSE false 
      END AS has_critical_failure
    FROM public.chaos_run_verdict
    WHERE started_at >= now() - make_interval(hours => 24)
      AND status IN ('completed', 'failed')
  )
  SELECT
    CASE 
      WHEN NOT EXISTS (SELECT 1 FROM recent_runs) THEN false
      WHEN EXISTS (
        SELECT 1 FROM recent_runs WHERE has_critical_failure = true
      ) THEN false
      WHEN (SELECT AVG(passed_ratio) FROM recent_runs) < 80.0 THEN false
      ELSE true
    END AS gate_passed,
    CASE 
      WHEN NOT EXISTS (SELECT 1 FROM recent_runs) THEN 'No recent chaos runs found'
      WHEN EXISTS (
        SELECT 1 FROM recent_runs WHERE has_critical_failure = true
      ) THEN 'Critical failures detected in recent runs'
      WHEN (SELECT AVG(passed_ratio) FROM recent_runs) < 80.0 
      THEN format('Success rate %.1f%% below threshold 80.0%%', 
        (SELECT AVG(passed_ratio) FROM recent_runs))
      ELSE NULL
    END AS failure_reason,
    COUNT(*)::bigint AS recent_runs_count,
    COALESCE(AVG(passed_ratio), 0)::numeric AS success_rate,
    COUNT(*) FILTER (WHERE has_critical_failure = true)::bigint AS critical_failures
  FROM recent_runs;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.active_chaos_alerts_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_chaos_alerts_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.chaos_gate_check() TO authenticated;
GRANT EXECUTE ON FUNCTION public.chaos_gate_check() TO service_role;

-- =============================================================================
-- TEST WITH PROPER BASE TABLE INSERTS
-- =============================================================================

-- 1. Create a failing chaos run
INSERT INTO public.chaos_runs (
    name, seed, total_runs, concurrency, failure_rate, duplicate_event_rate,
    stall_probability, latency_profile_ms, status, started_at, finished_at
) VALUES (
    'Gate Failure Test',
    123456789,
    100,
    20,
    0.15,
    0.10,
    0.05,
    ARRAY[50, 500, 2000],
    'failed',
    now() - interval '1 hour',
    now() - interval '55 minutes'
) RETURNING id;

-- 2. Create failing instances
INSERT INTO public.chaos_run_instances (
    chaos_run_id, scenario_key, state, attempt_count, last_error
) 
SELECT 
    cr.id,
    format('run-%s', generate_series(1, 5)),
    CASE WHEN generate_series(1, 5) <= 3 THEN 'done' ELSE 'error' END,
    1,
    CASE WHEN generate_series(1, 5) > 3 THEN 'Chaos injected failure' END
FROM public.chaos_runs cr
WHERE cr.name = 'Gate Failure Test'
LIMIT 1;

-- 3. Inject fault events
INSERT INTO public.chaos_fault_injections (
    chaos_run_id, fault_type, phase, payload
)
SELECT 
    cr.id,
    'forced_error',
    'execute',
    '{"reason": "test failure", "injected": true}'::jsonb
FROM public.chaos_runs cr
WHERE cr.name = 'Gate Failure Test'
LIMIT 1;

-- 4. Create side effects (to test duplicate detection)
INSERT INTO public.side_effect_ledger (
    run_id, phase, effect_type, idempotency_key, request_payload, status
)
SELECT 
    cr.id::text,
    'execute',
    'stripe_charge',
    'test-charge-1',
    '{"amount": 14900}'::jsonb,
    'succeeded'
FROM public.chaos_runs cr
WHERE cr.name = 'Gate Failure Test'
LIMIT 1;

-- =============================================================================
-- VALIDATION QUERIES
-- =============================================================================

-- Test 1: Check if gate detects failure
SELECT 'GATE TEST' as test_name, gate_passed, failure_reason 
FROM public.chaos_gate_check();

-- Test 2: Check if alerts fire
SELECT 'ALERT TEST' as test_name, COUNT(*) as alert_count
FROM public.chaos_alerts;

-- Test 3: Check signal quality
SELECT 'SIGNAL TEST' as test_name, * 
FROM public.active_chaos_alerts_count();

-- Test 4: Show alert details
SELECT 'ALERT DETAILS' as test_name, run_id, failure_reason, severity, requires_action
FROM public.chaos_alerts;

-- =============================================================================
-- CLEANUP
-- =============================================================================

-- Uncomment to clean up test data
-- DELETE FROM public.chaos_runs WHERE name = 'Gate Failure Test';
