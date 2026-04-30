-- ========================================
-- DISABLE OLD RETRY CRON JOB
-- Migration path for elevated permissions
-- Run this in Supabase SQL Editor (requires appropriate permissions)
-- ========================================

-- ========================================
-- STEP 1: Identify the old retry job
-- ========================================

DO $$
DECLARE
    v_old_job record;
    v_new_job record;
BEGIN
    -- Get old job details
    SELECT * INTO v_old_job 
    FROM cron.job 
    WHERE jobname = 'retry_failed_jobs';
    
    -- Get new job details
    SELECT * INTO v_new_job 
    FROM cron.job 
    WHERE jobname = 'hydi-retry-failed-guarded';
    
    IF v_old_job IS NULL THEN
        RAISE NOTICE 'Old retry_failed_jobs cron job not found - may already be disabled';
    ELSE
        RAISE NOTICE 'Found old job: % with schedule: %', v_old_job.jobname, v_old_job.schedule;
        
        IF v_new_job IS NULL THEN
            RAISE WARNING 'New guarded retry job not found! Please run guarded-retry-cron-setup.sql first.';
        ELSE
            RAISE NOTICE 'New guarded job confirmed: %', v_new_job.jobname;
        END IF;
    END IF;
END $$;

-- ========================================
-- STEP 2: Safe disable (unschedule) old retry job
-- ========================================

-- Option A: Unschedule (completely remove) - RECOMMENDED
-- Uncomment below if you have permission:
-- SELECT cron.unschedule('retry_failed_jobs');

-- Option B: Disable without unscheduling (if unschedule not permitted)
-- This requires a different approach - see alternative below

-- ========================================
-- STEP 3: Alternative - Mark as deprecated if can't unschedule
-- ========================================

-- If you cannot unschedule due to permissions, insert a deprecation marker
INSERT INTO public.system_control_flags (
    flag_name,
    flag_value,
    reason,
    set_by
)
SELECT 
    'retry_failed_jobs_deprecated',
    TRUE,
    'Old retry_failed_jobs cron is deprecated. Use hydi-retry-failed-guarded instead.',
    'migration_script'
WHERE NOT EXISTS (
    SELECT 1 FROM public.system_control_flags 
    WHERE flag_name = 'retry_failed_jobs_deprecated'
);

-- ========================================
-- STEP 4: Create monitoring view for deprecated job
-- ========================================

CREATE OR REPLACE VIEW public.cron_job_audit AS
SELECT 
    j.jobname,
    j.schedule,
    j.active,
    j.jobid,
    CASE 
        WHEN j.jobname = 'retry_failed_jobs' THEN 'DEPRECATED - Use hydi-retry-failed-guarded'
        WHEN j.jobname = 'hydi-retry-failed-guarded' THEN 'ACTIVE - Guarded retry with pause support'
        WHEN j.jobname LIKE 'hydi-%' THEN 'HYDI system job'
        ELSE 'Other job'
    END as status_note,
    COALESCE(
        (SELECT flag_value 
         FROM public.system_control_flags 
         WHERE flag_name = 'retry_failed_jobs_deprecated'),
        FALSE
    ) as is_deprecated_flag_set,
    (SELECT MAX(starttime) 
     FROM cron.job_run_details 
     WHERE jobname = j.jobname) as last_run
FROM cron.job j
ORDER BY 
    CASE WHEN j.jobname LIKE 'hydi-%' THEN 0 ELSE 1 END,
    j.jobname;

-- ========================================
-- STEP 5: Manual disable instructions (if automated fails)
-- ========================================

/*
If you cannot unschedule via SQL due to permissions, run this from psql
or Supabase dashboard with elevated privileges:

-- Connect to your project:
psql "postgresql://postgres.akbnfovjdcobifeupvbn:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

-- Then run:
SELECT cron.unschedule('retry_failed_jobs');

-- Or disable all non-HYDI retry jobs:
SELECT cron.unschedule(jobname) 
FROM cron.job 
WHERE jobname = 'retry_failed_jobs';
*/

-- ========================================
-- VERIFICATION
-- ========================================

-- Show current state of all retry-related jobs
SELECT 
    jobname,
    schedule,
    active,
    status_note
FROM public.cron_job_audit
WHERE jobname LIKE '%retry%' OR jobname LIKE '%failed%'
ORDER BY jobname;

-- Show deprecation flag status
SELECT 
    flag_name,
    flag_value,
    reason,
    created_at
FROM public.system_control_flags
WHERE flag_name = 'retry_failed_jobs_deprecated';

-- Success message
SELECT 'Migration complete. Old retry job marked as deprecated.' as result;
SELECT 'To fully remove old job, run SELECT cron.unschedule(''retry_failed_jobs''); with elevated permissions' as note;
