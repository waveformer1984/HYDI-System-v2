-- FINAL FIXES - Run these in order in Supabase SQL Editor

-- 1. FIX gen_random_bytes schema qualification
-- First ensure pgcrypto is in the right place
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- Fix publish_event function
CREATE OR REPLACE FUNCTION public.publish_event(
    p_topic text,
    p_event_name text,
    p_payload jsonb default '{}',
    p_source_worker text default null
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_event_id uuid := encode(pgcrypto.gen_random_bytes(16), 'hex')::uuid;
BEGIN
    INSERT INTO public.event_bus_events (
        id,
        topic,
        event_name,
        payload,
        source_worker,
        occurred_at
    ) VALUES (
        v_event_id,
        p_topic,
        p_event_name,
        p_payload,
        p_source_worker,
        now()
    );
    RETURN v_event_id;
END;
$$;

-- Fix invoke_worker_orchestrator (if it uses gen_random_bytes)
CREATE OR REPLACE FUNCTION public.invoke_worker_orchestrator(
    p_queue_name text,
    p_batch_size integer default 10
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_url text;
    v_key text;
    v_request_id bigint;
BEGIN
    select decrypted_secret into v_url from vault.decrypted_secrets where name in ('project_url','supabase_project_url') order by name limit 1;
    select decrypted_secret into v_key from vault.decrypted_secrets where name in ('publishable_key','anon_key') order by name limit 1;

    if v_url is null or v_key is null then
        perform public.publish_event(
            'system:alerts',
            'worker_invoke_skipped_missing_vault',
            jsonb_build_object('queue_name', p_queue_name, 'needs', array['project_url','publishable_key|anon_key'])
        );
        return null;
    end if;

    select net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/worker-orchestrator',
        headers := jsonb_build_object(
            'Content-Type','application/json',
            'Authorization','Bearer ' || v_key
        ),
        body := jsonb_build_object(
            'queue_name', p_queue_name,
            'worker_name', 'cron:' || p_queue_name,
            'batch_size', greatest(coalesce(p_batch_size,10),1)
        )
    ) into v_request_id;

    return v_request_id;
END;
$$;

-- 2. CREATE worker_status VIEW (compatibility layer)
CREATE OR REPLACE VIEW public.worker_status AS
SELECT 
    'worker-' || queue_name || '-' || id::text as worker_id,
    queue_name as worker_type,
    CASE 
        WHEN status = 'processing' THEN 'busy'
        WHEN status = 'failed' THEN 'error'
        ELSE 'idle'
    END as status,
    updated_at as last_heartbeat,
    id as current_task_id,
    CASE WHEN status = 'done' THEN 1 ELSE 0 END as processed_count,
    CASE WHEN status = 'failed' THEN 1 ELSE 0 END as error_count,
    payload as metadata
FROM worker_jobs
WHERE status IN ('processing', 'failed', 'done')
   OR updated_at > NOW() - INTERVAL '5 minutes';

-- Also create worker_queues view for full compatibility
CREATE OR REPLACE VIEW public.worker_queues AS
SELECT 
    id,
    queue_name,
    job_type,
    payload,
    status,
    priority,
    attempts,
    3 as max_attempts,
    error_message,
    created_at,
    started_at,
    completed_at,
    updated_at
FROM worker_jobs;

-- 3. VERIFY CRON JOBS
-- First check existing cron jobs
SELECT jobid, jobname, schedule, active 
FROM cron.job 
WHERE jobname LIKE 'orchestrator-%'
ORDER BY jobid;

-- If missing, create them
SELECT cron.schedule('orchestrator-revenue', '* * * * *', $$
    SELECT public.invoke_worker_orchestrator('revenue', 20);
$$);

SELECT cron.schedule('orchestrator-provisioning', '* * * * *', $$
    SELECT public.invoke_worker_orchestrator('provisioning', 20);
$$);

SELECT cron.schedule('orchestrator-router', '* * * * *', $$
    SELECT public.invoke_worker_orchestrator('router', 20);
$$);

SELECT cron.schedule('orchestrator-fabrication', '*/2 * * * *', $$
    SELECT public.invoke_worker_orchestrator('fabrication', 10);
$$);

SELECT cron.schedule('orchestrator-notifications', '* * * * *', $$
    SELECT public.invoke_worker_orchestrator('notifications', 25);
$$);

-- 4. FINAL VERIFICATION QUERIES
SELECT 'worker_jobs_status' as check_name, status, count(*) 
FROM worker_jobs 
GROUP BY status
ORDER BY status;

SELECT 'worker_failures' as check_name, count(*) as total
FROM worker_failures;

SELECT 'event_bus_events' as check_name, count(*) as total
FROM event_bus_events
WHERE created_at > NOW() - INTERVAL '1 hour';

SELECT 'cron_jobs' as check_name, count(*) FILTER (WHERE active = true) as active_jobs
FROM cron.job
WHERE jobname LIKE 'orchestrator-%';
