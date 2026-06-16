-- ProtoForge Calibration Worker
--
-- Closes the feedback loop: finds approved decisions that haven't had their
-- outcome backfilled yet, matches them to execution results in the actions
-- table, and writes success/failure/unknown back to decisions.outcome.
--
-- Two resolution paths:
--   1. MATCHED  — a row in `actions` has metadata->>'hypothesis_id' matching
--                 decisions.hypothesis_id; outcome maps from action status.
--   2. TIMED OUT — decision is older than `p_timeout_minutes` with no match;
--                  outcome is set to 'unknown' so the calibration scan doesn't
--                  revisit it indefinitely.
--
-- Called by the protoforge-calibration Edge Function and by the pg_cron job.

CREATE OR REPLACE FUNCTION public.calibrate_protoforge_decisions(
  p_grace_minutes   INT DEFAULT 5,    -- minimum age before a decision is eligible
  p_timeout_minutes INT DEFAULT 60    -- after this, mark unresolved as 'unknown'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved_success  INT := 0;
  v_resolved_failure  INT := 0;
  v_resolved_unknown  INT := 0;
  v_skipped           INT := 0;
  v_cutoff_grace      TIMESTAMPTZ;
  v_cutoff_timeout    TIMESTAMPTZ;
BEGIN
  v_cutoff_grace   := now() - (p_grace_minutes   || ' minutes')::INTERVAL;
  v_cutoff_timeout := now() - (p_timeout_minutes || ' minutes')::INTERVAL;

  -- ── Path 1: resolve via matched action status ───────────────────────────────
  WITH matched AS (
    SELECT
      d.id                                    AS decision_id,
      CASE a.status
        WHEN 'completed' THEN 'success'
        WHEN 'failed'    THEN 'failure'
        ELSE NULL                               -- still running — skip for now
      END                                     AS resolved_outcome,
      jsonb_build_object(
        'action_id',     a.id,
        'action_status', a.status,
        'action_type',   a.action_type,
        'resolved_via',  'action_match'
      )                                       AS detail
    FROM public.decisions d
    JOIN public.actions   a
      ON a.metadata->>'hypothesis_id' = d.hypothesis_id
    WHERE d.outcome   IS NULL
      AND d.decision  = 'approve'
      AND d.decided_at < v_cutoff_grace
  ),
  updates AS (
    UPDATE public.decisions dst
    SET
      outcome        = m.resolved_outcome,
      outcome_at     = now(),
      outcome_detail = m.detail
    FROM matched m
    WHERE dst.id = m.decision_id
      AND m.resolved_outcome IS NOT NULL
    RETURNING dst.id, m.resolved_outcome
  )
  SELECT
    COUNT(*) FILTER (WHERE resolved_outcome = 'success') INTO v_resolved_success
  FROM updates;

  GET DIAGNOSTICS v_resolved_success = ROW_COUNT;

  -- re-count properly (GET DIAGNOSTICS only counts last DML)
  SELECT
    COUNT(*) FILTER (WHERE u.resolved_outcome = 'success'),
    COUNT(*) FILTER (WHERE u.resolved_outcome = 'failure')
  INTO v_resolved_success, v_resolved_failure
  FROM (
    SELECT d.outcome AS resolved_outcome
    FROM public.decisions d
    WHERE d.outcome_at >= now() - INTERVAL '10 seconds'
      AND d.outcome IN ('success','failure')
      AND d.outcome_detail->>'resolved_via' = 'action_match'
  ) u;

  -- ── Path 2: timeout — no matching action found within timeout window ────────
  UPDATE public.decisions
  SET
    outcome        = 'unknown',
    outcome_at     = now(),
    outcome_detail = jsonb_build_object(
      'resolved_via',     'timeout',
      'timeout_minutes',  p_timeout_minutes
    )
  WHERE outcome     IS NULL
    AND decision    = 'approve'
    AND decided_at  < v_cutoff_timeout
    AND NOT EXISTS (
      SELECT 1 FROM public.actions a
      WHERE a.metadata->>'hypothesis_id' = decisions.hypothesis_id
    );

  GET DIAGNOSTICS v_resolved_unknown = ROW_COUNT;

  -- ── Path 3: count decisions still within grace period (skipped) ─────────────
  SELECT COUNT(*) INTO v_skipped
  FROM public.decisions
  WHERE outcome  IS NULL
    AND decision = 'approve'
    AND decided_at >= v_cutoff_grace;

  RETURN jsonb_build_object(
    'resolved_success', v_resolved_success,
    'resolved_failure', v_resolved_failure,
    'resolved_unknown', v_resolved_unknown,
    'skipped_in_grace', v_skipped,
    'total_resolved',   v_resolved_success + v_resolved_failure + v_resolved_unknown,
    'calibrated_at',    now()
  );
END;
$$;

-- Grant execution to service role only (Edge Function uses service key)
REVOKE ALL ON FUNCTION public.calibrate_protoforge_decisions(INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calibrate_protoforge_decisions(INT, INT) TO service_role;

-- ── pg_cron: run every 5 minutes ───────────────────────────────────────────────
-- Requires pg_cron extension (already enabled on this project via billing-retry-worker).
-- Idempotent: unschedule first in case the job was registered with different params.
SELECT cron.unschedule('protoforge-calibration')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'protoforge-calibration'
);

SELECT cron.schedule(
  'protoforge-calibration',
  '*/5 * * * *',
  $$SELECT public.calibrate_protoforge_decisions(5, 60)$$
);
