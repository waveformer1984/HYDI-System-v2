-- ========================================
-- SYSTEM CONTROL FLAG HELPERS
-- Convenience functions for managing pause windows
-- ========================================

-- ========================================
-- Pause retry_failed_jobs temporarily
-- ========================================

CREATE OR REPLACE FUNCTION public.pause_retry_jobs(
    p_duration_minutes INTEGER DEFAULT 10,
    p_reason TEXT DEFAULT 'Manual pause'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.system_control_flags (
        flag_name,
        flag_value,
        reason,
        expires_at,
        set_by
    ) VALUES (
        'pause_retry_failed_jobs',
        TRUE,
        p_reason,
        NOW() + (p_duration_minutes || ' minutes')::INTERVAL,
        COALESCE(current_setting('request.jwt.claims', true)::json->>'sub', 'system')
    )
    ON CONFLICT (flag_name) 
    DO UPDATE SET
        flag_value = TRUE,
        reason = p_reason,
        expires_at = NOW() + (p_duration_minutes || ' minutes')::INTERVAL,
        created_at = NOW();
    
    -- Log the pause event
    INSERT INTO public.event_bus_events (
        topic, event_name, payload, occurred_at
    ) VALUES (
        'system:control',
        'retry_jobs_paused',
        jsonb_build_object(
            'reason', p_reason,
            'duration_minutes', p_duration_minutes,
            'expires_at', NOW() + (p_duration_minutes || ' minutes')::INTERVAL,
            'paused_by', COALESCE(current_setting('request.jwt.claims', true)::json->>'sub', 'system')
        ),
        NOW()
    );
    
    RETURN format('Retry jobs paused for %s minutes. Reason: %s', p_duration_minutes, p_reason);
END;
$$;

-- ========================================
-- Resume retry_failed_jobs
-- ========================================

CREATE OR REPLACE FUNCTION public.resume_retry_jobs()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_was_paused BOOLEAN;
BEGIN
    SELECT flag_value INTO v_was_paused
    FROM public.system_control_flags
    WHERE flag_name = 'pause_retry_failed_jobs';
    
    DELETE FROM public.system_control_flags
    WHERE flag_name = 'pause_retry_failed_jobs';
    
    IF v_was_paused THEN
        -- Log the resume event
        INSERT INTO public.event_bus_events (
            topic, event_name, payload, occurred_at
        ) VALUES (
            'system:control',
            'retry_jobs_resumed',
            jsonb_build_object(
                'resumed_at', NOW(),
                'resumed_by', COALESCE(current_setting('request.jwt.claims', true)::json->>'sub', 'system')
            ),
            NOW()
        );
        
        RETURN 'Retry jobs resumed.';
    ELSE
        RETURN 'Retry jobs were not paused.';
    END IF;
END;
$$;

-- ========================================
-- Check pause status
-- ========================================

CREATE OR REPLACE FUNCTION public.get_retry_pause_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_flag RECORD;
BEGIN
    SELECT * INTO v_flag
    FROM public.system_control_flags
    WHERE flag_name = 'pause_retry_failed_jobs';
    
    IF v_flag IS NULL THEN
        RETURN jsonb_build_object(
            'is_paused', FALSE,
            'message', 'Retry jobs are active'
        );
    END IF;
    
    RETURN jsonb_build_object(
        'is_paused', v_flag.flag_value,
        'reason', v_flag.reason,
        'expires_at', v_flag.expires_at,
        'minutes_remaining', 
            CASE 
                WHEN v_flag.expires_at > NOW() 
                THEN EXTRACT(EPOCH FROM (v_flag.expires_at - NOW())) / 60
                ELSE 0
            END,
        'set_by', v_flag.set_by,
        'created_at', v_flag.created_at
    );
END;
$$;

-- ========================================
-- List all active control flags
-- ========================================

CREATE OR REPLACE VIEW public.active_control_flags AS
SELECT 
    flag_name,
    flag_value,
    reason,
    created_at,
    expires_at,
    CASE 
        WHEN expires_at IS NULL THEN 'Never'
        WHEN expires_at < NOW() THEN 'Expired'
        ELSE format('%s minutes', ROUND(EXTRACT(EPOCH FROM (expires_at - NOW())) / 60))
    END as time_remaining,
    set_by
FROM public.system_control_flags
WHERE flag_value = TRUE
  AND (expires_at IS NULL OR expires_at > NOW())
ORDER BY created_at DESC;

-- ========================================
-- USAGE EXAMPLES
-- ========================================

-- Pause retries for 30 minutes during maintenance:
-- SELECT pause_retry_jobs(30, 'Database maintenance window');

-- Check if retries are paused:
-- SELECT get_retry_pause_status();

-- Resume retries immediately:
-- SELECT resume_retry_jobs();

-- View all active control flags:
-- SELECT * FROM active_control_flags;

-- Success message
SELECT 'Control flag helper functions created successfully' as result;
