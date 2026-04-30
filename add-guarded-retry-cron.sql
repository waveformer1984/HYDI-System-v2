-- ========================================
-- ADD GUARDED RETRY CRON JOB
-- Copy/paste this entire block into Supabase SQL Editor
-- ========================================

-- Step 1: Ensure system_control_flags table exists
CREATE TABLE IF NOT EXISTS public.system_control_flags (
    flag_name TEXT PRIMARY KEY,
    flag_value BOOLEAN DEFAULT FALSE,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    set_by TEXT
);

ALTER TABLE public.system_control_flags ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'system_control_flags' 
        AND policyname = 'Service role can manage control flags'
    ) THEN
        CREATE POLICY "Service role can manage control flags"
            ON public.system_control_flags
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- Step 2: Schedule the new guarded retry job
-- First check if it exists and unschedule if so
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hydi-retry-failed-guarded') THEN
        PERFORM cron.unschedule('hydi-retry-failed-guarded');
    END IF;
END $$;

-- Now schedule it
SELECT cron.schedule(
    'hydi-retry-failed-guarded',
    '*/5 * * * *',
    $$SELECT public.retry_failed_jobs_guarded();$$
);

-- Step 3: Verification - show all retry-related cron jobs
SELECT 
    jobname,
    schedule,
    active,
    CASE 
        WHEN jobname = 'hydi-retry-failed-guarded' THEN '✅ NEW - Guarded retry with pause support'
        WHEN jobname = 'retry_failed_jobs' THEN '⚠️ OLD - Consider disabling when ready'
        ELSE 'Other job'
    END as notes
FROM cron.job 
WHERE jobname LIKE '%retry%' 
   OR jobname LIKE '%failed%'
   OR jobname LIKE 'hydi-%'
ORDER BY jobname;

-- Step 4: Test the pause mechanism
-- (Uncomment to test pausing for 5 minutes)
-- INSERT INTO public.system_control_flags (flag_name, flag_value, reason, expires_at)
-- VALUES ('pause_retry_failed_jobs', TRUE, 'Test pause', NOW() + INTERVAL '5 minutes')
-- ON CONFLICT (flag_name) DO UPDATE SET flag_value = TRUE, expires_at = NOW() + INTERVAL '5 minutes';

-- Check current pause status
SELECT 
    'pause_retry_failed_jobs' as flag,
    EXISTS(SELECT 1 FROM public.system_control_flags WHERE flag_name = 'pause_retry_failed_jobs' AND flag_value = TRUE) as is_active,
    (SELECT expires_at FROM public.system_control_flags WHERE flag_name = 'pause_retry_failed_jobs') as expires_at;

-- Success message
SELECT 'Guarded retry cron job (hydi-retry-failed-guarded) scheduled successfully' as result;
SELECT 'This job runs every 5 minutes and respects pause windows from system_control_flags' as note;
