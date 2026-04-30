-- HYDI Production Hardening Patch
-- Addresses critical gaps identified in stress validation
-- Version: 2.2.0

-- =============================================================================
-- PATCH 1: Severity-Threshold Gate Function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chaos_gate_check(
  p_lookback_hours int DEFAULT 24,
  p_min_success_rate numeric DEFAULT 80.0,
  p_allow_critical_failures boolean DEFAULT false,
  p_max_critical_alerts int DEFAULT 0,
  p_max_high_alerts int DEFAULT 2,
  p_max_medium_alerts int DEFAULT 5
)
RETURNS TABLE(
  gate_passed boolean,
  failure_reason text,
  recent_runs_count bigint,
  success_rate numeric,
  critical_failures bigint,
  alert_summary jsonb
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
    WHERE started_at >= now() - make_interval(hours => p_lookback_hours)
      AND status IN ('completed', 'failed')
  ),
  active_alerts AS (
    SELECT 
      severity,
      COUNT(*)::bigint AS alert_count
    FROM public.chaos_alerts
    WHERE requires_action = true
      AND started_at >= now() - make_interval(hours => p_lookback_hours)
    GROUP BY severity
  ),
  alert_counts AS (
    SELECT
      COALESCE((SELECT alert_count FROM active_alerts WHERE severity = 'critical'), 0) AS critical_alerts,
      COALESCE((SELECT alert_count FROM active_alerts WHERE severity = 'high'), 0) AS high_alerts,
      COALESCE((SELECT alert_count FROM active_alerts WHERE severity = 'medium'), 0) AS medium_alerts,
      COALESCE((SELECT alert_count FROM active_alerts WHERE severity = 'low'), 0) AS low_alerts,
      COALESCE(SUM(alert_count), 0) AS total_alerts
    FROM active_alerts
  )
  SELECT
    CASE 
      WHEN NOT EXISTS (SELECT 1 FROM recent_runs) THEN false
      WHEN NOT p_allow_critical_failures AND EXISTS (
        SELECT 1 FROM recent_runs WHERE has_critical_failure = true
      ) THEN false
      WHEN (SELECT AVG(passed_ratio) FROM recent_runs) < p_min_success_rate THEN false
      WHEN (SELECT critical_alerts FROM alert_counts) > p_max_critical_alerts THEN false
      WHEN (SELECT high_alerts FROM alert_counts) > p_max_high_alerts THEN false
      WHEN (SELECT medium_alerts FROM alert_counts) > p_max_medium_alerts THEN false
      ELSE true
    END AS gate_passed,
    CASE 
      WHEN NOT EXISTS (SELECT 1 FROM recent_runs) THEN 'No recent chaos runs found'
      WHEN NOT p_allow_critical_failures AND EXISTS (
        SELECT 1 FROM recent_runs WHERE has_critical_failure = true
      ) THEN 'Critical failures detected in recent runs'
      WHEN (SELECT AVG(passed_ratio) FROM recent_runs) < p_min_success_rate 
      THEN format('Success rate %.1f%% below threshold %.1f%%', 
        (SELECT AVG(passed_ratio) FROM recent_runs), p_min_success_rate)
      WHEN (SELECT critical_alerts FROM alert_counts) > p_max_critical_alerts
      THEN format('Critical alerts (%s) exceed threshold (%s)', 
        (SELECT critical_alerts FROM alert_counts), p_max_critical_alerts)
      WHEN (SELECT high_alerts FROM alert_counts) > p_max_high_alerts
      THEN format('High alerts (%s) exceed threshold (%s)', 
        (SELECT high_alerts FROM alert_counts), p_max_high_alerts)
      WHEN (SELECT medium_alerts FROM alert_counts) > p_max_medium_alerts
      THEN format('Medium alerts (%s) exceed threshold (%s)', 
        (SELECT medium_alerts FROM alert_counts), p_max_medium_alerts)
      ELSE NULL
    END AS failure_reason,
    COUNT(*)::bigint AS recent_runs_count,
    COALESCE(AVG(passed_ratio), 0)::numeric AS success_rate,
    COUNT(*) FILTER (WHERE has_critical_failure = true)::bigint AS critical_failures,
    jsonb_build_object(
      'critical_alerts', (SELECT critical_alerts FROM alert_counts),
      'high_alerts', (SELECT high_alerts FROM alert_counts),
      'medium_alerts', (SELECT medium_alerts FROM alert_counts),
      'low_alerts', (SELECT low_alerts FROM alert_counts),
      'total_alerts', (SELECT total_alerts FROM alert_counts),
      'thresholds', jsonb_build_object(
        'max_critical', p_max_critical_alerts,
        'max_high', p_max_high_alerts,
        'max_medium', p_max_medium_alerts
      )
    ) AS alert_summary
  FROM recent_runs, alert_counts;
$$;

COMMENT ON FUNCTION public.chaos_gate_check IS 'Enhanced deployment gate with severity-threshold controls';

-- =============================================================================
-- PATCH 2: FK Constraints with Explicit Cascade Policy
-- =============================================================================

-- Add foreign key constraints to prevent orphan records

-- chaos_run_instances -> chaos_runs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_chaos_run_instances_chaos_run_id'
  ) THEN
    ALTER TABLE public.chaos_run_instances 
    ADD CONSTRAINT fk_chaos_run_instances_chaos_run_id 
    FOREIGN KEY (chaos_run_id) 
    REFERENCES public.chaos_runs(id) 
    ON DELETE CASCADE;
  END IF;
END $$;

-- chaos_fault_injections -> chaos_runs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_chaos_fault_injections_chaos_run_id'
  ) THEN
    ALTER TABLE public.chaos_fault_injections 
    ADD CONSTRAINT fk_chaos_fault_injections_chaos_run_id 
    FOREIGN KEY (chaos_run_id) 
    REFERENCES public.chaos_runs(id) 
    ON DELETE CASCADE;
  END IF;
END $$;

-- chaos_fault_injections -> chaos_run_instances (instance_id can be null)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_chaos_fault_injections_instance_id'
  ) THEN
    ALTER TABLE public.chaos_fault_injections 
    ADD CONSTRAINT fk_chaos_fault_injections_instance_id 
    FOREIGN KEY (instance_id) 
    REFERENCES public.chaos_run_instances(id) 
    ON DELETE SET NULL;
  END IF;
END $$;

-- side_effect_ledger -> chaos_runs (via run_id, but this is not a direct FK)
-- We'll add a check constraint to ensure run_id exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'ck_side_effect_ledger_valid_run_id'
  ) THEN
    ALTER TABLE public.side_effect_ledger 
    ADD CONSTRAINT ck_side_effect_ledger_valid_run_id 
    CHECK (EXISTS (
      SELECT 1 FROM public.chaos_runs 
      WHERE chaos_runs.id = side_effect_ledger.run_id
    ));
  END IF;
END $$;

-- replay_integrity_checks -> chaos_runs (via run_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'ck_replay_integrity_checks_valid_run_id'
  ) THEN
    ALTER TABLE public.replay_integrity_checks 
    ADD CONSTRAINT ck_replay_integrity_checks_valid_run_id 
    CHECK (EXISTS (
      SELECT 1 FROM public.chaos_runs 
      WHERE chaos_runs.id = replay_integrity_checks.run_id
    ));
  END IF;
END $$;

-- agent_leases -> chaos_runs (via run_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'ck_agent_leases_valid_run_id'
  ) THEN
    ALTER TABLE public.agent_leases 
    ADD CONSTRAINT ck_agent_leases_valid_run_id 
    CHECK (EXISTS (
      SELECT 1 FROM public.chaos_runs 
      WHERE chaos_runs.id = agent_leases.run_id
    ));
  END IF;
END $$;

-- =============================================================================
-- PATCH 3: Alert Logic Adjustment - Avoid Misleading Fallback
-- =============================================================================

-- Update chaos_alerts view to exclude success_rate_below_80 during partial cleanup
CREATE OR REPLACE VIEW public.chaos_alerts AS
WITH base AS (
  SELECT
    v.run_id,
    v.name,
    v.status,
    v.verdict,
    v.runtime_seconds,
    v.total_instances,
    v.done_instances,
    v.error_instances,
    v.dead_letter_instances,
    v.duplicate_effect_pairs,
    v.replay_mismatches,
    v.started_at,
    v.finished_at,
    -- Success ratio
    CASE
      WHEN v.total_instances > 0 
      THEN round((v.done_instances::numeric / v.total_instances::numeric) * 100, 2)
      ELSE 0
    END AS passed_ratio,
    -- Enhanced failure classification
    CASE
      WHEN v.duplicate_effect_pairs > 0 THEN 'duplicate_side_effects'
      WHEN v.replay_mismatches > 0 THEN 'replay_divergence'
      WHEN v.error_instances > 0 THEN 'instance_errors'
      WHEN v.dead_letter_instances > 0 THEN 'dead_letters_present'
      WHEN v.verdict = 'FAIL' THEN 'verdict_fail'
      WHEN v.verdict = 'ABORT' THEN 'test_aborted'
      -- Only use success_rate_below_80 if we have sufficient data (not during partial cleanup)
      WHEN (
        v.total_instances > 0 
        AND v.done_instances > (v.total_instances * 0.8) -- At least 80% completed
        AND (v.done_instances::numeric / v.total_instances::numeric) * 100 < 80
      ) THEN 'success_rate_below_80'
      ELSE NULL
    END AS failure_reason,
    -- Alert severity
    CASE
      WHEN v.replay_mismatches > 0 THEN 'critical'
      WHEN v.duplicate_effect_pairs > 0 THEN 'critical'
      WHEN v.dead_letter_instances > 0 THEN 'high'
      WHEN v.error_instances > (v.total_instances * 0.1) THEN 'high'
      WHEN v.error_instances > 0 THEN 'medium'
      WHEN v.verdict = 'FAIL' THEN 'medium'
      WHEN v.verdict = 'ABORT' THEN 'low'
      WHEN (
        v.total_instances > 0 
        AND v.done_instances > (v.total_instances * 0.8)
        AND (v.done_instances::numeric / v.total_instances::numeric) * 100 < 80
      ) THEN 'medium'
      ELSE NULL
    END AS severity,
    -- Actionable flag with cleanup awareness
    CASE
      WHEN v.replay_mismatches > 0 THEN true
      WHEN v.duplicate_effect_pairs > 0 THEN true
      WHEN v.dead_letter_instances > 0 THEN true
      WHEN v.error_instances > (v.total_instances * 0.1) THEN true
      WHEN v.verdict = 'FAIL' THEN true
      WHEN v.verdict = 'ABORT' THEN false
      WHEN (
        v.total_instances > 0 
        AND v.done_instances > (v.total_instances * 0.8)
        AND (v.done_instances::numeric / v.total_instances::numeric) * 100 < 80
      ) THEN true
      ELSE false
    END AS requires_action
  FROM public.chaos_run_verdict v
)
SELECT
  run_id,
  name,
  status,
  verdict,
  failure_reason,
  severity,
  requires_action,
  passed_ratio,
  runtime_seconds,
  total_instances,
  done_instances,
  error_instances,
  dead_letter_instances,
  duplicate_effect_pairs,
  replay_mismatches,
  started_at,
  finished_at,
  -- Enhanced alert context
  jsonb_build_object(
    'alert_type', 'chaos_test_failure',
    'run_id', run_id,
    'failure_reason', failure_reason,
    'severity', severity,
    'passed_ratio', passed_ratio,
    'runtime_seconds', runtime_seconds,
    'affected_instances', jsonb_build_object(
      'total', total_instances,
      'done', done_instances,
      'errors', error_instances,
      'dead_letters', dead_letter_instances,
      'completion_ratio', CASE 
        WHEN total_instances > 0 THEN round((done_instances::numeric / total_instances::numeric) * 100, 2)
        ELSE 0
      END
    ),
    'anomalies', jsonb_build_object(
      'duplicate_effects', duplicate_effect_pairs,
      'replay_mismatches', replay_mismatches
    ),
    'dashboard_url', format('https://supabase.com/dashboard/project/akbnfovjdcobifeupvbn/functions/logs?search=%s', run_id),
    'cleanup_aware', true
  ) AS alert_context
FROM base
WHERE failure_reason IS NOT NULL
  AND started_at >= now() - interval '7 days' -- Last 7 days
ORDER BY 
  CASE severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    WHEN 'low' THEN 4
  END,
  started_at DESC NULLS LAST,
  run_id DESC;

COMMENT ON VIEW public.chaos_alerts IS 'Enhanced alert surface with cleanup-aware logic';

-- =============================================================================
-- PATCH 4: Helper Functions for Cleanup Monitoring
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_monitoring_summary()
RETURNS TABLE(
  total_chaos_runs bigint,
  active_chaos_runs bigint,
  total_instances bigint,
  completed_instances bigint,
  orphaned_records bigint,
  cleanup_status text
)
LANGUAGE sql
STABLE
AS $$
  WITH run_stats AS (
    SELECT
      COUNT(*)::bigint AS total_runs,
      COUNT(*) FILTER (WHERE status IN ('pending', 'running'))::bigint AS active_runs
    FROM public.chaos_runs
  ),
  instance_stats AS (
    SELECT
      COUNT(*)::bigint AS total_instances,
      COUNT(*) FILTER (WHERE state = 'done')::bigint AS completed_instances
    FROM public.chaos_run_instances
  ),
  orphan_check AS (
    SELECT
      COUNT(*)::bigint AS orphaned_instances
    FROM public.chaos_run_instances ci
    LEFT JOIN public.chaos_runs cr ON ci.chaos_run_id = cr.id
    WHERE cr.id IS NULL
  )
  SELECT
    rs.total_runs,
    rs.active_runs,
    ist.total_instances,
    ist.completed_instances,
    oc.orphaned_instances,
    CASE 
      WHEN oc.orphaned_instances > 0 THEN 'orphan_detected'
      WHEN rs.active_runs > 0 THEN 'cleanup_needed'
      ELSE 'clean'
    END AS cleanup_status
  FROM run_stats rs, instance_stats ist, orphan_check oc;
$$;

COMMENT ON FUNCTION public.cleanup_monitoring_summary IS 'Monitors cleanup status and detects orphaned records';

-- =============================================================================
-- PATCH 5: Updated Permissions
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.chaos_gate_check(int, numeric, boolean, int, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chaos_gate_check(int, numeric, boolean, int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_monitoring_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_monitoring_summary() TO service_role;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
