-- Set up pg_cron schedule for action-worker
-- This will automatically invoke action-worker every minute to process queued actions

-- First, ensure pg_cron is enabled
SELECT cron.schedule(
  'action-worker-every-minute',
  '* * * * *',  -- Every minute
  $$
  SELECT net.http_post(
    url := 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/action-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE',
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
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE',
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
