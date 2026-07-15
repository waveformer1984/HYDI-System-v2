-- SECURITY FIX: 20260426122000_action_worker_cron_schedule.sql hardcoded a live
-- service_role JWT directly into the pg_cron schedule and trigger_action_worker()
-- function body. That embeds the bearer token in cron.job/pg_proc source on the
-- live database (readable by anyone with SQL access), and the plaintext value was
-- also committed to source control. This migration replaces both with the
-- Vault-backed pattern already established by 20260426123500_billing_retry_cron.sql
-- (secrets 'action_worker_project_url' / 'action_worker_service_jwt', populated
-- out-of-band via `node add-vault-secrets.js` -- never via a committed migration).
--
-- The previously-hardcoded key must be rotated in the Supabase dashboard; this
-- migration only fixes how the *replacement* secret is stored and referenced.

-- Remove the insecure cron job (recreated below against the safe function).
DO $$
DECLARE
  v_job_id int;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'action-worker-every-minute'
       OR command ILIKE '%action-worker%'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END $$;

-- Redefine trigger_action_worker() to pull the URL and bearer token from Vault
-- instead of embedding them in the function body.
CREATE OR REPLACE FUNCTION public.trigger_action_worker(p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_jwt text;
  v_response jsonb;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'action_worker_project_url'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret INTO v_jwt
  FROM vault.decrypted_secrets
  WHERE name = 'action_worker_service_jwt'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_url IS NULL OR v_jwt IS NULL THEN
    RAISE EXCEPTION 'Missing Vault secrets for action-worker invoker (action_worker_project_url / action_worker_service_jwt)';
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/action-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_jwt,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('limit', p_limit)
  ) INTO v_response;

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_action_worker(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_action_worker(int) TO service_role;

-- Reschedule against the safe function (no literal secret in the cron command).
SELECT cron.schedule(
  'action-worker-every-minute',
  '* * * * *',
  'SELECT public.trigger_action_worker(10);'
);
