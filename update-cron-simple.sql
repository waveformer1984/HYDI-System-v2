-- Update cron job to use simple header-based auth for heidi-reflect
-- This replaces HMAC signing with simple secret header matching

-- First, unschedule existing job if it exists
SELECT cron.unschedule('heidi-reflect-every-10-min');

-- Schedule with simplified header auth
SELECT cron.schedule(
  'heidi-reflect-every-10-min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/heidi-reflect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-heidi-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'heidi_reflect_secret' ORDER BY created_at DESC LIMIT 1)
    ),
    body := jsonb_build_object('window_minutes', 10),
    timeout_milliseconds := 30000
  );
  $$
);

-- Verify the updated job
SELECT 
  jobid, 
  jobname, 
  schedule, 
  active,
  LEFT(command, 200) as command_preview
FROM cron.job 
WHERE jobname = 'heidi-reflect-every-10-min';
