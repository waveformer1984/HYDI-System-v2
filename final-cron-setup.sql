-- ========================================
-- FINAL CRON SETUP - Clean & Safe
-- Run this in Supabase SQL Editor
-- ========================================

-- Process queue every minute
select cron.schedule(
  'process_worker_queues',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/worker-orchestrator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('queue_name', 'revenue', 'batch_size', 20),
    timeout_milliseconds := 5000
  ) as request_id;
  $$
);

-- Retry failed jobs every 5 minutes
select cron.schedule(
  'retry_failed_jobs',
  '*/5 * * * *',
  $$ select public.retry_failed_jobs(); $$
);

-- Flag dead jobs every 10 minutes
select cron.schedule(
  'flag_dead_jobs',
  '*/10 * * * *',
  $$ select public.flag_dead_jobs(); $$
);

-- ========================================
-- VERIFICATION QUERIES
-- Run these after setup
-- ========================================

-- 1. Check cron jobs are registered
select jobname, schedule, active
from cron.job
where jobname in ('process_worker_queues', 'retry_failed_jobs', 'flag_dead_jobs')
order by jobname;

-- 2. Check recent cron executions (last hour)
select 
    jobname,
    status,
    starttime,
    endtime,
    return_message
from cron.job_run_details
where starttime > now() - interval '1 hour'
  and jobname in ('process_worker_queues', 'retry_failed_jobs', 'flag_dead_jobs')
order by starttime desc
limit 10;

-- 3. Check HTTP responses from queue processor
select 
    request_id::text,
    status_code,
    message,
    timed_out
from net._http_response
where created_at > now() - interval '1 hour'
order by created_at desc
limit 5;

-- 4. Quick system health
select 
    'queue_health' as metric,
    (select count(*) from worker_jobs where status = 'queued')::text as value,
    case when (select count(*) from worker_jobs where status = 'queued') > 20 then '⚠️  BACKLOG' else '✅ OK' end as status
union all
select 
    'failed_jobs' as metric,
    (select count(*) from worker_jobs where status = 'failed')::text as value,
    case when (select count(*) from worker_jobs where status = 'failed') > 0 then '⚠️  NEEDS RETRY' else '✅ OK' end as status
union all
select 
    'dead_jobs' as metric,
    (select count(*) from worker_jobs where status = 'dead')::text as value,
    case when (select count(*) from worker_jobs where status = 'dead') > 0 then '🚨  DEAD JOBS' else '✅ OK' end as status
order by metric;
