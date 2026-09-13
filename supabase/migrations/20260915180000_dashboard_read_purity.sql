-- ============================================================================
-- Make system_dashboard a pure read: separate escalation calculation from
-- escalation persistence.
--
-- Problem
-- -------
-- system_dashboard calls evaluate_system_escalation(), and that function wrote
-- a row to event_bus_events. A view that mutates is not merely untidy here --
-- it is unusable, because PostgREST serves GET in a read-only transaction:
--
--   BEGIN READ ONLY; SELECT current_status FROM system_dashboard; ROLLBACK;
--     ERROR: cannot execute INSERT in a read-only transaction
--            PL/pgSQL function evaluate_system_escalation() line 46
--
-- api/health.js reads the dashboard through PostgREST, so once the escalation
-- branch became reachable (>= 3 CRITICAL runs in the last 10) every health read
-- failed, and heidi-web crashed on the resulting error.
--
-- 20260915170000 fixed the NOT NULL event_type omission in that INSERT. It was
-- necessary but not sufficient: a correct INSERT in a read-only transaction
-- still fails. This migration removes the write from the read path entirely.
--
-- After
-- -----
--   evaluate_system_escalation()  -- PURE. calculation only. what the view calls.
--   record_system_escalation()    -- calculation + explicit persistence.
--                                    owned by the health scheduler.
--
-- The calculation is byte-identical: same thresholds (>= 3 CRITICAL in last 10,
-- WARNING persisting > 15 min), same levels, actions, reasons, and the same
-- returned jsonb shape. Nothing about the health verdict changes. Only the
-- write moves.
--
-- The view's full dependency path after this migration is
-- analyze_health_trends() (already pure -- verified: no INSERT/UPDATE in its
-- body) and evaluate_system_escalation() (pure as of this migration), so
-- system_dashboard performs no writes through any nested call.
--
-- auto_heal_from_trends()
-- -----------------------
-- Carries the same event_type omission. It is NOT reachable from the dashboard
-- read path -- system_dashboard calls only analyze_health_trends() and
-- evaluate_system_escalation(); its `auto_heals_24h` column merely COUNTS rows
-- with topic 'system:auto_heal'. auto_heal_from_trends() is invoked explicitly
-- by RPC (api/chat/route.js:132 and :602), which is already a write path, so
-- its persistence stays where it is. Only the missing column is supplied.
--
-- event_type values are mirrored from topic, exactly as in 20260915170000 and
-- for the same documented reason: lib/commercial/projections/
-- event-bus-events-adapter.ts:80 resolves `row.topic ?? row.event_type`, so
-- writing the same value into both keeps the projected event identical while
-- satisfying the NOT NULL constraint. No new vocabulary is introduced.
--
-- Idempotent: CREATE OR REPLACE FUNCTION throughout.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. evaluate_system_escalation() -- now PURE. Safe for the view to call.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_system_escalation()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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

  -- NO INSERT HERE. Persistence lives in record_system_escalation().
  -- Marked STABLE so the planner can also reject an accidental write later.
  RETURN jsonb_build_object(
    'level', v_level,
    'action', v_action,
    'reason', v_reason,
    'critical_in_last_10', v_critical_recent
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. record_system_escalation() -- the explicit write path. Scheduler-owned.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_system_escalation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_escalation jsonb;
  v_action TEXT;
  v_level TEXT;
  v_recorded BOOLEAN := false;
BEGIN
  v_escalation := evaluate_system_escalation();
  v_action := v_escalation->>'action';
  v_level := v_escalation->>'level';

  IF v_action IS DISTINCT FROM 'none' THEN
    INSERT INTO event_bus_events (event_type, topic, event_name, payload, occurred_at)
    VALUES (
      'system:escalation',
      'system:escalation',
      'escalation_' || LOWER(v_level),
      jsonb_build_object(
        'level', v_level,
        'action', v_action,
        'reason', v_escalation->>'reason',
        'evaluated_at', NOW()
      ),
      NOW()
    );
    v_recorded := true;
  END IF;

  RETURN v_escalation || jsonb_build_object('recorded', v_recorded);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. auto_heal_from_trends() -- supply the NOT NULL event_type. Nothing else
--    changes: it is an explicit RPC write path, not part of the read path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_heal_from_trends()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
    INSERT INTO event_bus_events (event_type, topic, event_name, payload, occurred_at)
    VALUES (
      'system:auto_heal',
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
$function$;
