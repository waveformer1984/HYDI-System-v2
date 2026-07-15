-- Set up pg_cron schedule for action-worker
-- This will automatically invoke action-worker every minute to process queued actions
--
-- SECURITY NOTE (2026-07-15): this migration originally embedded a literal
-- service_role bearer token directly in the cron command and function body
-- below. That token must be treated as compromised (it was committed to
-- source control) and rotated in the Supabase dashboard. The literal value
-- has been redacted from this file's current tree content; both the cron
-- job and the function are superseded by
-- 20260715210000_secure_action_worker_cron.sql, which redefines them to
-- read the URL/token from Vault instead. This file is left in place only
-- as a historical record of the original migration and is NOT the source
-- of truth for the live cron job/function definition.

-- First, ensure pg_cron is enabled
SELECT cron.schedule(
  'action-worker-every-minute',
  '* * * * *',  -- Every minute
  $$
  SELECT net.http_post(
    url := 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/action-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer [REDACTED-ROTATE-AND-USE-VAULT]',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('limit', 10)
  );
  $$
);

-- Create a function to manually trigger the action-worker
CREATE OR REPLACE FUNCTION public.trigger_action_worker(p_limit int DEFAULT 10)
RETURNS jsonb AS $$
DECLARE
  v_response jsonb;
BEGIN
  -- Use pg_net to call the action-worker function
  SELECT net.http_post(
    url := 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/action-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer [REDACTED-ROTATE-AND-USE-VAULT]',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('limit', p_limit)
  ) INTO v_response;

  RETURN v_response;
END;
$$ LANGUAGE plpgsql;

-- Create a function to check the cron schedule status
CREATE OR REPLACE FUNCTION public.get_cron_schedules()
RETURNS TABLE (
  scheduleid bigint,
  schedule text,
  command text,
  next_run timestamptz,
  last_run timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    scheduleid,
    schedule,
    command,
    next_run,
    last_run
  FROM cron.job
  WHERE schedule = 'action-worker-every-minute'
  ORDER BY scheduleid;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions to service role
GRANT EXECUTE ON FUNCTION public.trigger_action_worker TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cron_schedules TO service_role;
