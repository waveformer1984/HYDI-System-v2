-- Create worker_status view for backward compatibility
-- Run this in Supabase SQL Editor

-- This view provides the worker_status interface that local workers expect
-- Using the actual worker_jobs table as the source

CREATE OR REPLACE VIEW public.worker_status AS
SELECT 
    'worker-' || wj.queue_name || '-' || wj.id::text as worker_id,
    ww.worker_type,
    CASE 
        WHEN wj.status = 'processing' THEN 'busy'
        WHEN wj.status = 'failed' THEN 'error'
        WHEN wj.status = 'done' THEN 'idle'
        ELSE 'idle'
    END as status,
    wj.updated_at as last_heartbeat,
    wj.id as current_task_id,
    CASE WHEN wj.status = 'done' THEN 1 ELSE 0 END as processed_count,
    CASE WHEN wj.status = 'failed' THEN 1 ELSE 0 END as error_count,
    jsonb_build_object(
        'queue_name', ww.queue_name,
        'job_type', wj.job_type,
        'attempts', wj.attempts,
        'priority', wj.priority,
        'payload', wj.payload
    ) as metadata
FROM public.worker_jobs wj
JOIN (
    -- Get latest job per worker type
    SELECT DISTINCT
        queue_name as worker_type,
        queue_name,
        ROW_NUMBER() OVER (PARTITION BY queue_name ORDER BY updated_at DESC) as rn
    FROM public.worker_jobs
) ww ON ww.queue_name = wj.queue_name AND ww.rn = 1
WHERE wj.status IN ('processing', 'failed', 'done')
   OR wj.updated_at > NOW() - INTERVAL '5 minutes';

-- Create worker_queues view as well for full compatibility
CREATE OR REPLACE VIEW public.worker_queues AS
SELECT 
    wj.id,
    wj.queue_name,
    wj.job_type,
    wj.payload,
    wj.status,
    wj.priority,
    wj.attempts,
    3 as max_attempts,
    wj.error_message,
    wj.created_at,
    wj.started_at,
    wj.completed_at,
    wj.available_at,
    wj.updated_at,
    wj.locked_by,
    wj.lease_expires_at,
    wj.dedupe_key
FROM public.worker_jobs wj;

-- Grant access
GRANT SELECT ON public.worker_status TO authenticated, anon, service_role;
GRANT SELECT ON public.worker_queues TO authenticated, anon, service_role;

-- Test the view
SELECT 'worker_status view created' as result,
       (SELECT count(*) FROM public.worker_status) as active_workers;

SELECT 'worker_queues view created' as result,
       (SELECT count(*) FROM public.worker_queues) as total_jobs;
