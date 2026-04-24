
-- ========================================
-- CASCADE HARDENING SQL
-- Run this in Supabase SQL Editor
-- ========================================

-- 1. Unique constraint on webhook_events.event_id
ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_event_id_unique UNIQUE (event_id);

-- 2. Index on worker_jobs status+created_at
CREATE INDEX IF NOT EXISTS worker_jobs_status_created_at_idx 
ON worker_jobs (status, created_at DESC);

-- 3. Index on worker_jobs priority
CREATE INDEX IF NOT EXISTS worker_jobs_priority_idx 
ON worker_jobs (priority DESC, created_at);

-- 4. Retry failed jobs function
CREATE OR REPLACE FUNCTION retry_failed_jobs()
RETURNS TABLE(retried_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_retried bigint := 0;
BEGIN
    -- Move failed jobs back to queue if they haven't exceeded max attempts
    UPDATE worker_jobs 
    SET status = 'queued',
        attempts = attempts + 1,
        error_message = NULL,
        available_at = NOW() + (attempts * 30) * INTERVAL '1 second',
        updated_at = NOW()
    WHERE id IN (
        SELECT job_id FROM worker_failures
        WHERE failed_at > NOW() - INTERVAL '1 hour'
        AND attempts < 3
    );
    
    GET DIAGNOSTICS v_retried = ROW_COUNT;
    
    -- Remove from failures table
    DELETE FROM worker_failures 
    WHERE job_id IN (
        SELECT id FROM worker_jobs WHERE status = 'queued'
    );
    
    RETURN NEXT v_retried;
END;
$$;

-- 5. Dead job handler function
CREATE OR REPLACE FUNCTION flag_dead_jobs()
RETURNS TABLE(flagged_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_flagged bigint := 0;
BEGIN
    -- Flag jobs stuck in processing for too long
    UPDATE worker_jobs
    SET status = 'dead',
        updated_at = NOW()
    WHERE status = 'processing'
      AND updated_at < NOW() - INTERVAL '15 minutes';
    
    GET DIAGNOSTICS v_flagged = ROW_COUNT;
    
    RETURN NEXT v_flagged;
END;
$$;

-- 6. Cron job for processing queues
SELECT cron.schedule(
    'process_worker_queues',
    '* * * * *',
    $$
    SELECT claim_jobs('revenue', 'cron-worker', 20, 60);
    SELECT claim_jobs('provisioning', 'cron-worker', 10, 60);
    SELECT claim_jobs('router', 'cron-worker', 5, 60);
    $$
);

-- 7. Cron job for retrying failures
SELECT cron.schedule(
    'retry_failed_jobs',
    '*/5 * * * *',
    $$
    SELECT retry_failed_jobs();
    $$
);

-- 8. Cron job for cleanup
SELECT cron.schedule(
    'cleanup_old_jobs',
    '0 2 * * *',
    $$
    DELETE FROM worker_jobs 
    WHERE status = 'done' 
      AND completed_at < NOW() - INTERVAL '7 days';
    
    DELETE FROM worker_failures 
    WHERE failed_at < NOW() - INTERVAL '7 days';
    $$
);

-- ========================================
-- VALIDATION QUERIES
-- Run these to verify setup
-- ========================================

-- Check indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('worker_jobs', 'webhook_events')
  AND schemaname = 'public'
ORDER BY tablename, indexname;

-- Check cron jobs
SELECT jobid, jobname, schedule, active 
FROM cron.job 
WHERE jobname LIKE '%worker%'
ORDER BY jobid;

-- Check functions
SELECT 
    proname as function_name,
    pg_get_functiondef(oid) as definition
FROM pg_proc 
WHERE proname IN ('retry_failed_jobs', 'flag_dead_jobs')
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
