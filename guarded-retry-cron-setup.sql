-- ========================================
-- GUARDED RETRY CRON SETUP
-- Adds new retry job with pause window support
-- Run this in Supabase SQL Editor
-- ========================================

-- ========================================
-- STEP 1: Create/verify system_control_flags table
-- ========================================

CREATE TABLE IF NOT EXISTS public.system_control_flags (
    flag_name TEXT PRIMARY KEY,
    flag_value BOOLEAN DEFAULT FALSE,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    set_by TEXT
);

-- Enable RLS
ALTER TABLE public.system_control_flags ENABLE ROW LEVEL SECURITY;

-- Service role policy
CREATE POLICY IF NOT EXISTS "Service role can manage control flags"
    ON public.system_control_flags
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ========================================
-- STEP 2: Ensure retry_failed_jobs_guarded() exists
-- (Skip if already created)
-- ========================================

-- Note: Assumes retry_failed_jobs_guarded() was already created
-- If not, create it here:
/*
CREATE OR REPLACE FUNCTION public.retry_failed_jobs_guarded()
RETURNS TABLE(retried_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_retried bigint := 0;
    v_paused boolean;
BEGIN
    -- Check if retries are paused
    SELECT flag_value INTO v_paused
    FROM public.system_control_flags
    WHERE flag_name = 'pause_retry_failed_jobs'
      AND (expires_at IS NULL OR expires_at > NOW());
    
    IF v_paused THEN
        -- Log skipped retry
        INSERT INTO public.event_bus_events (
            topic, event_name, payload, occurred_at
        ) VALUES (
            'system:control',
            'retry_skipped_paused',
            jsonb_build_object(
                'reason', 'Retries paused via system_control_flags',
                'timestamp', NOW()
            ),
            NOW()
        );
        RETURN NEXT 0;
        RETURN;
    END IF;
    
    -- Call the actual retry function
    SELECT * INTO v_retried FROM public.retry_failed_jobs();
    
    RETURN NEXT v_retried;
END;
$$;
*/

-- ========================================
-- STEP 3: Schedule new guarded retry cron job
-- ========================================

-- First, check if a job with this name already exists
DO $$
DECLARE
    v_job_exists boolean;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM cron.job 
        WHERE jobname = 'hydi-retry-failed-guarded'
    ) INTO v_job_exists;
    
    IF v_job_exists THEN
        -- Unschedule existing
        PERFORM cron.unschedule('hydi-retry-failed-guarded');
        RAISE NOTICE 'Unscheduled existing hydi-retry-failed-guarded job';
    END IF;
END $$;

-- Schedule the new guarded retry job (every 5 minutes)
SELECT cron.schedule(
    'hydi-retry-failed-guarded',
    '*/5 * * * *',
    $$SELECT public.retry_failed_jobs_guarded();$$
);

-- ========================================
-- STEP 4: Verification
-- ========================================

-- Show all hydi-related cron jobs
SELECT 
    jobname,
    schedule,
    active,
    CASE 
        WHEN jobname = 'hydi-retry-failed-guarded' THEN 'NEW - Guarded retry with pause support'
        WHEN jobname LIKE 'hydi-%' THEN 'HYDI system job'
        WHEN jobname = 'retry_failed_jobs' THEN 'OLD - Consider disabling (see migration script)'
        ELSE 'Other job'
    END as notes
FROM cron.job 
WHERE jobname LIKE 'hydi-%' 
   OR jobname = 'retry_failed_jobs'
   OR jobname = 'flag_dead_jobs'
ORDER BY jobname;

-- Success message
SELECT 'Guarded retry cron job scheduled successfully' as result;
SELECT 'Next: Run disable-old-retry-cron.sql to disable the old retry job' as next_step;
