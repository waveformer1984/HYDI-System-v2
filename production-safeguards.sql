-- PRODUCTION SAFEGUARDS
-- Silent failure prevention and monitoring

-- 1. Alert thresholds and views
CREATE OR REPLACE VIEW public.system_health AS
SELECT 
    'queue_backlog' as metric,
    (SELECT count(*) FROM worker_jobs WHERE status = 'queued') as value,
    CASE 
        WHEN (SELECT count(*) FROM worker_jobs WHERE status = 'queued') > 50 THEN 'CRITICAL'
        WHEN (SELECT count(*) FROM worker_jobs WHERE status = 'queued') > 20 THEN 'WARNING'
        ELSE 'OK'
    END as status,
    'Jobs waiting in queue' as description

UNION ALL

SELECT 
    'stuck_jobs' as metric,
    (SELECT count(*) FROM worker_jobs 
     WHERE status = 'processing' 
     AND updated_at < NOW() - INTERVAL '5 minutes') as value,
    CASE 
        WHEN (SELECT count(*) FROM worker_jobs 
              WHERE status = 'processing' 
              AND updated_at < NOW() - INTERVAL '5 minutes') > 0 THEN 'CRITICAL'
        ELSE 'OK'
    END as status,
    'Jobs processing too long' as description

UNION ALL

SELECT 
    'failure_rate' as metric,
    ROUND(
        (SELECT count(*) FROM worker_failures 
         WHERE failed_at > NOW() - INTERVAL '1 hour')::numeric /
        NULLIF((SELECT count(*) FROM worker_jobs 
                WHERE created_at > NOW() - INTERVAL '1 hour'), 0) * 100, 2
    ) as value,
    CASE 
        WHEN (SELECT count(*) FROM worker_failures 
              WHERE failed_at > NOW() - INTERVAL '1 hour')::numeric /
             NULLIF((SELECT count(*) FROM worker_jobs 
                     WHERE created_at > NOW() - INTERVAL '1 hour'), 0) > 0.1 
        THEN 'CRITICAL'
        WHEN (SELECT count(*) FROM worker_failures 
              WHERE failed_at > NOW() - INTERVAL '1 hour')::numeric /
             NULLIF((SELECT count(*) FROM worker_jobs 
                     WHERE created_at > NOW() - INTERVAL '1 hour'), 0) > 0.05 
        THEN 'WARNING'
        ELSE 'OK'
    END as status,
    'Hourly failure rate (%)' as description

UNION ALL

SELECT 
    'webhook_errors' as metric,
    (SELECT count(*) FROM webhook_events 
     WHERE created_at > NOW() - INTERVAL '1 hour'
     AND processed = false) as value,
    CASE 
        WHEN (SELECT count(*) FROM webhook_events 
              WHERE created_at > NOW() - INTERVAL '1 hour'
              AND processed = false) > 5 THEN 'CRITICAL'
        WHEN (SELECT count(*) FROM webhook_events 
              WHERE created_at > NOW() - INTERVAL '1 hour'
              AND processed = false) > 0 THEN 'WARNING'
        ELSE 'OK'
    END as status,
    'Unprocessed webhook events' as description;

-- 2. Dead letter escalation function
CREATE OR REPLACE FUNCTION public.escalate_stuck_jobs()
RETURNS TABLE(escalated_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_escalated bigint := 0;
BEGIN
    -- Move jobs that have failed too many times
    INSERT INTO worker_failures (
        job_id, queue_name, job_type, payload, 
        error_message, failed_at, escalation_reason
    )
    SELECT 
        id, queue_name, job_type, payload,
        'Max attempts exceeded - escalated',
        NOW(), 'Too many failures'
    FROM worker_jobs
    WHERE status = 'failed' 
      AND attempts >= 3
      AND id NOT IN (SELECT job_id FROM worker_failures);
    
    GET DIAGNOSTICS v_escalated = ROW_COUNT;
    
    -- Delete escalated jobs from queue
    DELETE FROM worker_jobs
    WHERE status = 'failed' 
      AND attempts >= 3
      AND id IN (
          SELECT job_id FROM worker_failures 
          WHERE failed_at = NOW()
      );
    
    -- Alert on escalation
    IF v_escalated > 0 THEN
        PERFORM public.publish_event(
            'system:alerts',
            'jobs_escalated',
            jsonb_build_object(
                'count', v_escalated,
                'timestamp', now(),
                'action', 'review worker_failures table'
            )
        );
    END IF;
    
    RETURN NEXT v_escalated;
END;
$$;

-- 3. Event validation function
CREATE OR REPLACE FUNCTION public.validate_stripe_event_integrity(p_event_id text)
RETURNS TABLE(
    event_valid boolean,
    checks jsonb,
    issues text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_webhook_exists boolean;
    v_job_exists boolean;
    v_job_completed boolean;
    v_downstream_jobs integer;
    v_issues text[] := '{}';
    v_checks jsonb := '{}'::jsonb;
BEGIN
    -- Check if webhook was received
    SELECT EXISTS(
        SELECT 1 FROM webhook_events 
        WHERE event_id = p_event_id
    ) INTO v_webhook_exists;
    
    v_checks := jsonb_set(v_checks, '{webhook_received}', to_jsonb(v_webhook_exists));
    
    IF NOT v_webhook_exists THEN
        v_issues := array_append(v_issues, 'Webhook event not found');
    END IF;
    
    -- Check if job was created
    SELECT EXISTS(
        SELECT 1 FROM worker_jobs 
        WHERE payload->>'event_id' = p_event_id
    ) INTO v_job_exists;
    
    v_checks := jsonb_set(v_checks, '{job_created}', to_jsonb(v_job_exists));
    
    IF NOT v_job_exists THEN
        v_issues := array_append(v_issues, 'Worker job not created');
    END IF;
    
    -- Check if job completed
    SELECT status = 'done' INTO v_job_completed
    FROM worker_jobs 
    WHERE payload->>'event_id' = p_event_id
    ORDER BY created_at DESC
    LIMIT 1;
    
    v_checks := jsonb_set(v_checks, '{job_completed}', to_jsonb(v_job_completed));
    
    IF v_job_exists AND NOT v_job_completed THEN
        v_issues := array_append(v_issues, 'Job not completed');
    END IF;
    
    -- Check downstream jobs
    SELECT count(*) INTO v_downstream_jobs
    FROM worker_jobs
    WHERE payload->>'source_event_id' = p_event_id;
    
    v_checks := jsonb_set(v_checks, '{downstream_jobs}', to_jsonb(v_downstream_jobs));
    
    RETURN NEXT (
        v_issues = ARRAY[]::text[],
        v_checks,
        v_issues
    );
END;
$$;

-- 4. Automated health check (run via cron)
CREATE OR REPLACE FUNCTION public.run_health_checks()
RETURNS TABLE(
    check_name text,
    status text,
    details jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
    -- Check queue health
    RETURN QUERY
    SELECT 
        'queue_health' as check_name,
        status as status,
        jsonb_build_object(
            'queued_jobs', value,
            'threshold', 50,
            'timestamp', now()
        ) as details
    FROM system_health
    WHERE metric = 'queue_backlog';
    
    -- Check for stuck jobs
    RETURN QUERY
    SELECT 
        'stuck_jobs' as check_name,
        status as status,
        jsonb_build_object(
            'stuck_count', value,
            'threshold_minutes', 5,
            'timestamp', now()
        ) as details
    FROM system_health
    WHERE metric = 'stuck_jobs';
    
    -- Check webhook processing
    RETURN QUERY
    SELECT 
        'webhook_health' as check_name,
        status as status,
        jsonb_build_object(
            'error_count', value,
            'timeframe', '1 hour',
            'timestamp', now()
        ) as details
    FROM system_health
    WHERE metric = 'webhook_errors';
END;
$$;

-- 5. Create cron job for health checks
SELECT cron.schedule(
    'system-health-check',
    '*/5 * * * *',
    $$
    SELECT public.run_health_checks();
    SELECT public.escalate_stuck_jobs();
    $$
);

-- 6. Create alert subscription helper
CREATE OR REPLACE FUNCTION public.get_active_alerts()
RETURNS TABLE(
    alert_type text,
    severity text,
    message text,
    metric_value numeric,
    timestamp timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
SELECT 
    metric as alert_type,
    status as severity,
    description || ': ' || value as message,
    value as metric_value,
    now() as timestamp
FROM system_health
WHERE status != 'OK'
ORDER BY 
    CASE status WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
    metric;
$$;
