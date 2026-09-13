-- ============================================================================
-- Fix evaluate_system_escalation() — supply the NOT NULL event_type column
--
-- Problem
-- -------
-- evaluate_system_escalation() (defined in
-- 20260707151854_local_baseline_missing_core_objects.sql) records an escalation
-- event by writing to event_bus_events with the column list
-- (topic, event_name, payload, occurred_at) -- note the absence of event_type.
--
-- event_bus_events.event_type is NOT NULL with no default, so that write
-- always violates the constraint. The function is called from inside the
-- system_dashboard view, so the failure propagates out of a plain
-- `SELECT * FROM system_dashboard`, and api/health.js turns that into HTTP 500.
--
-- The branch was unreachable for as long as system_health_runs was empty:
-- v_critical_recent was 0, so v_action stayed 'none' and the INSERT never ran.
-- Once a real health producer began recording runs and three of the last ten
-- came back CRITICAL, the threshold at `v_critical_recent >= 3` was crossed and
-- every read of the dashboard started failing.
--
-- Choice of event_type value
-- --------------------------
-- Not invented. lib/commercial/projections/event-bus-events-adapter.ts:80 is
-- the consumer contract:
--
--     const eventType = row.topic ?? row.event_type ?? 'unknown';
--
-- with tests/unit/event-bus-events-adapter.test.ts asserting "prefers topic
-- over event_type for the event type". topic is the semantic identity and
-- event_type is the legacy fallback, so writing the same 'system:escalation'
-- value into both keeps the projected event identical while satisfying the
-- constraint. It also matches the namespace:name shape used elsewhere in the
-- table ('hydi:subscription_activated', 'agent_manager:task_dispatched').
--
-- Scope
-- -----
-- Only the INSERT column list and its matching value change. Thresholds,
-- levels, actions, reasons, payload, topic, event_name, occurred_at and the
-- returned jsonb are all byte-identical to the current definition. This does
-- not make the system healthy — it makes the escalation recordable so the
-- dashboard can be read while still reporting CRITICAL.
--
-- KNOWN, DELIBERATELY NOT FIXED HERE: the same migration defines a second
-- function whose auto-heal INSERT has the identical omission
-- (20260707151854...sql:560, topic 'system:auto_heal'). It is not currently
-- reachable (it requires v_healed > 0) and fixing it is out of this change's
-- scope. It is reported rather than silently swept in.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.evaluate_system_escalation()
 RETURNS jsonb
 LANGUAGE plpgsql
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

  IF v_action != 'none' THEN
    -- event_type added: NOT NULL with no default. Same value as topic, per the
    -- `row.topic ?? row.event_type` consumer contract.
    INSERT INTO event_bus_events (event_type, topic, event_name, payload, occurred_at)
    VALUES (
      'system:escalation',
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
$function$;
