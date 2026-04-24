-- ========================================
-- TREND ANALYSIS & AUTO-RESPONSE SYSTEM
-- ProtoForge HYDI Platform
-- Supabase Project: akbnfovjdcobifeupvbn
-- ========================================

-- ========================================
-- STEP 1A: analyze_health_trends()
-- Analyzes last 20 health runs for trend detection
-- ========================================

CREATE OR REPLACE FUNCTION analyze_health_trends()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_runs RECORD;
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
      'reason', 'No health runs found'
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

-- ========================================
-- STEP 1B: evaluate_system_escalation()
-- Detects escalation conditions and logs events
-- ========================================

CREATE OR REPLACE FUNCTION evaluate_system_escalation()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_critical_recent INT;
  v_warning_start TIMESTAMPTZ;
  v_warning_duration_min NUMERIC;
  v_action TEXT := 'none';
  v_reason TEXT := 'System stable';
  v_level TEXT := 'OK';
BEGIN
  -- Rule 1: 3+ CRITICAL in last 10 runs
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
    -- Rule 2: WARNING persisting > 15 minutes
    SELECT MIN(run_at) INTO v_warning_start
    FROM (
      SELECT run_at, status,
        LAG(status) OVER (ORDER BY run_at) AS prev_status
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

  -- Log escalation to event_bus_events if action needed
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

-- ========================================
-- STEP 1C: auto_heal_from_trends()
-- Performs auto-healing actions based on trends
-- ========================================

CREATE OR REPLACE FUNCTION auto_heal_from_trends()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trends jsonb;
  v_escalation jsonb;
  v_healed INT := 0;
  v_actions jsonb[] := ARRAY[]::jsonb[];
BEGIN
  v_trends := analyze_health_trends();
  v_escalation := evaluate_system_escalation();

  -- Auto-heal: retry stuck jobs if queue is degrading
  IF (v_trends->>'status') IN ('degrading', 'critical_trend') THEN
    PERFORM retry_failed_jobs();
    v_healed := v_healed + 1;
    v_actions := v_actions || jsonb_build_object(
      'action', 'retry_failed_jobs',
      'reason', 'Trend status: ' || (v_trends->>'status')
    );
  END IF;

  -- Auto-heal: flag dead jobs if critical trend
  IF (v_trends->>'status') = 'critical_trend' THEN
    PERFORM flag_dead_jobs();
    v_healed := v_healed + 1;
    v_actions := v_actions || jsonb_build_object(
      'action', 'flag_dead_jobs',
      'reason', 'Critical trend detected'
    );
  END IF;

  -- Emit auto-heal event
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

-- ========================================
-- STEP 2: SCHEDULE VIA pg_cron
-- ========================================

-- Run auto_heal_from_trends every 2 minutes
SELECT cron.schedule(
  'hydi-trend-auto-heal',
  '*/2 * * * *',
  $$SELECT auto_heal_from_trends();$$
);

-- Run evaluate_system_escalation every 5 minutes
SELECT cron.schedule(
  'hydi-escalation-check',
  '*/5 * * * *',
  $$SELECT evaluate_system_escalation();$$
);

-- ========================================
-- STEP 3: EXTEND system_dashboard VIEW
-- ========================================

CREATE OR REPLACE VIEW system_dashboard AS
SELECT
  -- Latest health run
  (SELECT status FROM system_health_runs 
   ORDER BY run_at DESC LIMIT 1) AS current_status,
  (SELECT run_at FROM system_health_runs 
   ORDER BY run_at DESC LIMIT 1) AS last_check,

  -- Trend analysis
  (analyze_health_trends()->>'status') AS trend_status,
  (analyze_health_trends()->>'reason') AS trend_reason,
  (analyze_health_trends()->'metrics'->>'critical_pct')::int AS critical_pct,
  (analyze_health_trends()->'metrics'->>'warning_pct')::int AS warning_pct,
  (analyze_health_trends()->'metrics'->>'avg_queue_size')::int AS avg_queue_size,

  -- Escalation
  (evaluate_system_escalation()->>'level') AS escalation_level,
  (evaluate_system_escalation()->>'action') AS escalation_action,
  (evaluate_system_escalation()->>'reason') AS escalation_reason,

  -- Live queue
  (SELECT COUNT(*) FROM worker_jobs WHERE status = 'queued') AS jobs_queued,
  (SELECT COUNT(*) FROM worker_jobs WHERE status = 'failed') AS jobs_failed,
  (SELECT COUNT(*) FROM worker_jobs WHERE status = 'dead') AS jobs_dead,

  -- Event flow
  (SELECT COUNT(*) FROM event_bus_events 
   WHERE occurred_at > NOW() - INTERVAL '1 hour') AS events_last_hour,

  -- Auto-heal history
  (SELECT COUNT(*) FROM event_bus_events 
   WHERE topic = 'system:auto_heal' 
   AND occurred_at > NOW() - INTERVAL '24 hours') AS auto_heals_24h,

  NOW() AS dashboard_generated_at;

-- ========================================
-- VERIFICATION QUERIES
-- Run these after installation
-- ========================================

-- Test trend analysis
-- SELECT analyze_health_trends();

-- Test escalation evaluation  
-- SELECT evaluate_system_escalation();

-- Test auto-heal
-- SELECT auto_heal_from_trends();

-- View dashboard
-- SELECT * FROM system_dashboard;

-- Check cron jobs registered:
-- SELECT jobname, schedule, active 
-- FROM cron.job 
-- WHERE jobname LIKE 'hydi-%';

-- Success message
SELECT 'Trend analysis and auto-response system installed successfully' AS result;
