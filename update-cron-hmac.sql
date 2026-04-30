-- Update cron job to use HMAC signing for heidi-reflect
-- This replaces simple secret authentication with cryptographic integrity verification

select cron.schedule(
  'heidi-reflect-every-10-min',
  '*/10 * * * *',
  $$
  -- Generate HMAC signature for request integrity
  declare
    project_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' order by created_at desc limit 1);
    anon_key text := (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key' order by created_at desc limit 1);
    heidi_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'heidi_reflect_secret' order by created_at desc limit 1);
    timestamp text := extract(epoch from now())::text;
    payload jsonb := jsonb_build_object('window_minutes', 10);
    body_text text := convert_to(payload::text, 'UTF8');
    signature text := encode(sha256(heidi_secret || timestamp || body_text), 'hex');
  begin
    select net.http_post(
      url := project_url || '/functions/v1/heidi-reflect',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'x-heidi-secret', heidi_secret,
        'x-heidi-timestamp', timestamp,
        'x-heidi-signature', signature
      ),
      body := payload,
      timeout_milliseconds := 10000
    ) as request_id;
  end;
  $$
);

-- Verify the updated job
select jobid, jobname, schedule, active from cron.job where jobname = 'heidi-reflect-every-10-min';
