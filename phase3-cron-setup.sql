-- PHASE 3 — CRON AUTOMATION

-- Create cron job for worker orchestration
SELECT cron.schedule(
    'worker-orchestrator-loop',
    '* * * * *',
    $$
    SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/worker-orchestrator',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
        ),
        body := jsonb_build_object(
            'queue_name', 'revenue',
            'batch_size', 20
        )
    );
    $$
);

-- Verify cron job
SELECT jobid, jobname, schedule, active 
FROM cron.job 
WHERE jobname = 'worker-orchestrator-loop';
