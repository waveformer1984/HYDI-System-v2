-- Set up pg_cron schedule for billing-retry-worker
-- This will automatically invoke billing-retry-worker every 2 minutes

-- Create function to invoke billing-retry-worker
CREATE OR REPLACE FUNCTION public.invoke_billing_retry_worker(p_batch_size int DEFAULT 20)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_jwt text;
  v_req_id bigint;
  v_batch_size int := greatest(1, least(coalesce(p_batch_size, 20), 100));
BEGIN
  -- Get secrets from Vault (reuse existing ones)
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
    RAISE EXCEPTION 'Missing Vault secrets for billing-retry-worker invoker';
  END IF;

  -- Call billing-retry-worker
  SELECT net.http_post(
    url := v_url || '/functions/v1/billing-retry-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_jwt,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object() -- empty body, use query param for batch size
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION public.invoke_billing_retry_worker(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_billing_retry_worker(int) TO postgres;
GRANT EXECUTE ON FUNCTION public.invoke_billing_retry_worker(int) TO service_role;

-- Remove any existing billing retry cron jobs
DO $$
DECLARE
  v_job_id int;
BEGIN
  FOR v_job_id IN 
    SELECT jobid 
    FROM cron.job 
    WHERE command ILIKE '%billing-retry-worker%'
       OR schedule = 'billing-retry-every-2-minutes'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END $$;

-- Schedule billing retry worker every 2 minutes
SELECT cron.schedule(
  'billing-retry-every-2-minutes',
  '*/2 * * * *',
  'SELECT public.invoke_billing_retry_worker(20);'
);

-- Create monitoring function to check retry health
CREATE OR REPLACE FUNCTION public.get_billing_retry_health()
RETURNS TABLE (
  total_failed bigint,
  due_for_retry bigint,
  terminal_failed bigint,
  avg_retry_count numeric,
  oldest_retry_age interval,
  newest_retry_age interval
) AS $$
BEGIN
  RETURN QUERY
  WITH retry_stats AS (
    SELECT 
      COUNT(*) FILTER (WHERE status = 'failed') as total_failed,
      COUNT(*) FILTER (WHERE status = 'failed' AND next_retry_at <= now()) as due_for_retry,
      COUNT(*) FILTER (WHERE status = 'failed' AND retry_count >= max_retries) as terminal_failed,
      AVG(retry_count) FILTER (WHERE status = 'failed') as avg_retry_count,
      MIN(next_retry_at) FILTER (WHERE status = 'failed' AND next_retry_at > now()) as oldest_retry,
      MAX(next_retry_at) FILTER (WHERE status = 'failed' AND next_retry_at > now()) as newest_retry
    FROM public.billing_jobs
  )
  SELECT 
    total_failed,
    due_for_retry,
    terminal_failed,
    avg_retry_count,
    CASE 
      WHEN oldest_retry IS NOT NULL THEN oldest_retry - now()
      ELSE NULL
    END as oldest_retry_age,
    CASE 
      WHEN newest_retry IS NOT NULL THEN newest_retry - now()
      ELSE NULL
    END as newest_retry_age
  FROM retry_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to health function
GRANT EXECUTE ON FUNCTION public.get_billing_retry_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_billing_retry_health() TO authenticated;
