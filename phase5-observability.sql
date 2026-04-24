-- PHASE 5 — OBSERVABILITY

-- Create views for monitoring
CREATE OR REPLACE VIEW public.active_jobs AS
SELECT 
    id,
    queue_name,
    job_type,
    status,
    created_at,
    started_at,
    attempts
FROM worker_jobs
WHERE status IN ('queued', 'processing')
ORDER BY created_at;

CREATE OR REPLACE VIEW public.failed_jobs AS
SELECT 
    id,
    queue_name,
    job_type,
    error_message,
    attempts,
    failed_at
FROM worker_failures
ORDER BY failed_at DESC;

CREATE OR REPLACE VIEW public.recent_events AS
SELECT 
    topic,
    event_name,
    source_worker,
    occurred_at,
    payload
FROM event_bus_events
ORDER BY occurred_at DESC
LIMIT 50;

-- Quick health check query
SELECT 
    'active_jobs' as metric,
    count(*) as value
FROM worker_jobs
WHERE status = 'processing'

UNION ALL

SELECT 
    'queued_jobs' as metric,
    count(*) as value
FROM worker_jobs
WHERE status = 'queued'

UNION ALL

SELECT 
    'failed_today' as metric,
    count(*) as value
FROM worker_failures
WHERE failed_at >= current_date;
