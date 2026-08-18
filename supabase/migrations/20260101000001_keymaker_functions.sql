-- ============================================================================
-- KEYMAKER FUNCTIONS & TRIGGERS
-- ============================================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER update_services_updated_at
        BEFORE UPDATE ON public.keymaker_services
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TRIGGER update_keys_updated_at
        BEFORE UPDATE ON public.keymaker_keys
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TRIGGER update_config_updated_at
        BEFORE UPDATE ON public.keymaker_config
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- KEYMAKER CORE FUNCTIONS
-- ============================================================================

-- Function: Issue a new key
CREATE OR REPLACE FUNCTION public.keymaker_issue_key(
    p_user_id UUID,
    p_role TEXT DEFAULT 'guest',
    p_tier TEXT DEFAULT 'starter',
    p_services TEXT[] DEFAULT NULL,
    p_scopes TEXT[] DEFAULT ARRAY['read'],
    p_duration_hours INTEGER DEFAULT 1,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (key_hash TEXT, expires_at TIMESTAMPTZ) AS $$
DECLARE
    v_key TEXT;
    v_key_hash TEXT;
    v_expires TIMESTAMPTZ;
BEGIN
    -- Generate cryptographically secure random key
    v_key := encode(gen_random_bytes(32), 'hex');
    v_key_hash := encode(digest(v_key, 'sha256'), 'hex');
    v_expires := now() + (p_duration_hours || ' hours')::interval;
    
    -- Store the hash
    INSERT INTO public.keymaker_keys (
        key_hash,
        user_id,
        role,
        tier,
        allowed_services,
        scopes,
        expires_at,
        metadata
    ) VALUES (
        v_key_hash,
        p_user_id,
        p_role,
        p_tier,
        COALESCE(p_services, ARRAY[]::TEXT[]),
        p_scopes,
        v_expires,
        p_metadata
    );
    
    RETURN QUERY SELECT v_key_hash, v_expires;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Validate key and log access
CREATE OR REPLACE FUNCTION public.keymaker_validate_and_route(
    p_key_hash TEXT,
    p_service_id TEXT,
    p_path TEXT,
    p_method TEXT,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS JSONB AS $$
DECLARE
    v_key RECORD;
    v_service RECORD;
    v_access_allowed BOOLEAN := false;
    v_reason TEXT := 'unknown';
    v_conditions JSONB := '[]'::jsonb;
    v_system_state RECORD;
    v_request_id TEXT;
    v_result JSONB;
BEGIN
    -- Generate request ID
    v_request_id := 'req_' || encode(gen_random_bytes(8), 'hex');
    
    -- Get system state
    SELECT * INTO v_system_state FROM public.keymaker_system_state LIMIT 1;
    
    -- Check maintenance mode
    IF v_system_state.maintenance_mode AND NOT p_metadata->>'role' = 'admin' THEN
        v_reason := 'system_maintenance';
        
        -- Log denied access
        INSERT INTO public.keymaker_access_log (
            request_id, user_id, role, service_id, path, method,
            allowed, reason, system_load, system_health
        ) VALUES (
            v_request_id, NULL, NULL, p_service_id, p_path, p_method,
            false, v_reason, v_system_state.load_level, v_system_state.health_status
        );
        
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', v_reason,
            'request_id', v_request_id,
            'maintenance_message', (SELECT value->>0 FROM public.keymaker_config WHERE key = 'maintenance_message')
        );
    END IF;
    
    -- Look up key
    SELECT * INTO v_key
    FROM public.keymaker_keys
    WHERE key_hash = p_key_hash
      AND revoked_at IS NULL
      AND expires_at > now();
    
    IF v_key IS NULL THEN
        v_reason := 'invalid_or_expired_key';
        
        INSERT INTO public.keymaker_access_log (
            request_id, service_id, path, method, allowed, reason,
            system_load, system_health
        ) VALUES (
            v_request_id, p_service_id, p_path, p_method, false, v_reason,
            v_system_state.load_level, v_system_state.health_status
        );
        
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', v_reason,
            'request_id', v_request_id
        );
    END IF;
    
    -- Look up service
    SELECT * INTO v_service
    FROM public.keymaker_services
    WHERE service_id = p_service_id AND enabled = true;
    
    IF v_service IS NULL THEN
        v_reason := 'service_not_found';
        
        INSERT INTO public.keymaker_access_log (
            request_id, user_id, key_id, service_id, path, method,
            allowed, reason, system_load, system_health
        ) VALUES (
            v_request_id, v_key.user_id, v_key.id, p_service_id, p_path, p_method,
            false, v_reason, v_system_state.load_level, v_system_state.health_status
        );
        
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', v_reason,
            'request_id', v_request_id
        );
    END IF;
    
    -- Check role
    IF NOT (v_key.role = ANY(v_service.allowed_roles) OR v_key.role = 'admin') THEN
        v_reason := 'insufficient_role';
        v_conditions := jsonb_build_array(jsonb_build_object('check', 'role', 'passed', false));
        
        INSERT INTO public.keymaker_access_log (
            request_id, user_id, key_id, service_id, path, method,
            allowed, reason, conditions_evaluated, system_load, system_health
        ) VALUES (
            v_request_id, v_key.user_id, v_key.id, p_service_id, p_path, p_method,
            false, v_reason, v_conditions, v_system_state.load_level, v_system_state.health_status
        );
        
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', v_reason,
            'required_roles', v_service.allowed_roles,
            'actual_role', v_key.role,
            'request_id', v_request_id
        );
    END IF;
    
    -- Check tier
    DECLARE
        tier_levels JSONB := '{"starter": 0, "pro": 1, "enterprise": 2}';
        user_tier_level INTEGER;
        required_tier_level INTEGER;
    BEGIN
        user_tier_level := COALESCE((tier_levels->>v_key.tier)::int, 0);
        required_tier_level := COALESCE((tier_levels->>v_service.min_tier)::int, 0);
        
        IF user_tier_level < required_tier_level THEN
            v_reason := 'tier_too_low';
            v_conditions := jsonb_build_array(
                jsonb_build_object('check', 'role', 'passed', true),
                jsonb_build_object('check', 'tier', 'passed', false)
            );
            
            INSERT INTO public.keymaker_access_log (
                request_id, user_id, key_id, service_id, path, method,
                allowed, reason, conditions_evaluated, system_load, system_health
            ) VALUES (
                v_request_id, v_key.user_id, v_key.id, p_service_id, p_path, p_method,
                false, v_reason, v_conditions, v_system_state.load_level, v_system_state.health_status
            );
            
            RETURN jsonb_build_object(
                'allowed', false,
                'reason', v_reason,
                'required_tier', v_service.min_tier,
                'actual_tier', v_key.tier,
                'request_id', v_request_id,
                'upgrade_url', '/api/subscriptions/upgrade'
            );
        END IF;
    END;
    
    -- Check service-specific conditions
    DECLARE
        v_condition JSONB;
        v_passed BOOLEAN := true;
        v_condition_results JSONB := '[]'::jsonb;
    BEGIN
        FOR v_condition IN SELECT * FROM jsonb_array_elements(v_service.conditions)
        LOOP
            DECLARE
                v_check_passed BOOLEAN := true;
                v_check_name TEXT;
            BEGIN
                v_check_name := v_condition->>'type';
                
                CASE v_check_name
                    WHEN 'system_health_green' THEN
                        v_check_passed := v_system_state.health_status IN ('green', 'yellow');
                    WHEN 'load_acceptable' THEN
                        v_check_passed := v_system_state.load_level IN ('normal', 'elevated');
                    WHEN 'not_maintenance' THEN
                        v_check_passed := NOT v_system_state.maintenance_mode;
                    WHEN 'rate_limit_ok' THEN
                        -- Would check actual rate limits here
                        v_check_passed := true;
                    ELSE
                        v_check_passed := true;
                END CASE;
                
                v_condition_results := v_condition_results || jsonb_build_object(
                    'check', v_check_name,
                    'passed', v_check_passed
                );
                
                IF NOT v_check_passed THEN
                    v_passed := false;
                END IF;
            END;
        END LOOP;
        
        IF NOT v_passed THEN
            v_reason := 'condition_failed';
            
            INSERT INTO public.keymaker_access_log (
                request_id, user_id, key_id, service_id, path, method,
                allowed, reason, conditions_evaluated, system_load, system_health
            ) VALUES (
                v_request_id, v_key.user_id, v_key.id, p_service_id, p_path, p_method,
                false, v_reason, v_condition_results, v_system_state.load_level, v_system_state.health_status
            );
            
            RETURN jsonb_build_object(
                'allowed', false,
                'reason', v_reason,
                'conditions', v_condition_results,
                'request_id', v_request_id
            );
        END IF;
        
        v_conditions := v_condition_results;
    END;
    
    -- Determine execution path based on system state
    DECLARE
        v_execution_path TEXT := 'direct';
        v_priority TEXT := 'low';
    BEGIN
        IF v_system_state.load_level = 'critical' THEN
            v_execution_path := 'queued';
        ELSIF v_system_state.load_level = 'elevated' THEN
            IF v_key.tier = 'enterprise' THEN
                v_execution_path := 'priority';
                v_priority := 'high';
            ELSIF v_key.tier = 'pro' THEN
                v_execution_path := 'standard';
                v_priority := 'medium';
            ELSE
                v_execution_path := 'queued';
            END IF;
        ELSE
            IF v_key.tier = 'enterprise' THEN
                v_execution_path := 'priority';
                v_priority := 'high';
            ELSIF v_key.tier = 'pro' THEN
                v_priority := 'medium';
            END IF;
        END IF;
        
        -- All checks passed - allow access
        v_access_allowed := true;
        v_reason := 'access_granted';
        
        -- Update key usage
        UPDATE public.keymaker_keys
        SET use_count = use_count + 1,
            last_used_at = now()
        WHERE id = v_key.id;
        
        -- Log successful access
        INSERT INTO public.keymaker_access_log (
            request_id, user_id, key_id, service_id, path, method,
            allowed, reason, conditions_evaluated, system_load, system_health
        ) VALUES (
            v_request_id, v_key.user_id, v_key.id, p_service_id, p_path, p_method,
            true, v_reason, v_conditions, v_system_state.load_level, v_system_state.health_status
        );
        
        RETURN jsonb_build_object(
            'allowed', true,
            'reason', v_reason,
            'request_id', v_request_id,
            'service_id', p_service_id,
            'execution_path', v_execution_path,
            'priority', v_priority,
            'identity', jsonb_build_object(
                'user_id', v_key.user_id,
                'role', v_key.role,
                'tier', v_key.tier
            ),
            'conditions', v_conditions
        );
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- ORACLE PREDICTION FUNCTIONS
-- ============================================================================

-- Function: Calculate behavioral score based on access patterns
CREATE OR REPLACE FUNCTION public.oracle_calculate_behavior_score(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_total_requests INTEGER;
    v_denied_requests INTEGER;
    v_avg_decision_time NUMERIC;
    v_pattern JSONB;
BEGIN
    -- Count requests in last 24 hours
    SELECT COUNT(*) INTO v_total_requests
    FROM public.keymaker_access_log
    WHERE user_id = p_user_id
      AND timestamp > now() - interval '24 hours';
    
    -- Count denied requests
    SELECT COUNT(*) INTO v_denied_requests
    FROM public.keymaker_access_log
    WHERE user_id = p_user_id
      AND allowed = false
      AND timestamp > now() - interval '24 hours';
    
    -- Calculate average decision time
    SELECT COALESCE(AVG(decision_time_ms), 0) INTO v_avg_decision_time
    FROM public.keymaker_access_log
    WHERE user_id = p_user_id
      AND timestamp > now() - interval '24 hours'
      AND decision_time_ms IS NOT NULL;
    
    RETURN jsonb_build_object(
        'total_requests', v_total_requests,
        'denied_requests', v_denied_requests,
        'deny_rate', CASE WHEN v_total_requests > 0 
            THEN (v_denied_requests::numeric / v_total_requests) 
            ELSE 0 END,
        'avg_decision_time_ms', v_avg_decision_time,
        'risk_score', CASE 
            WHEN v_denied_requests > 10 THEN 'high'
            WHEN v_denied_requests > 3 THEN 'medium'
            ELSE 'low'
        END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Predict next action based on pattern
CREATE OR REPLACE FUNCTION public.oracle_predict_next_action(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_most_used_service TEXT;
    v_prediction TEXT;
    v_confidence NUMERIC;
BEGIN
    -- Find most accessed service in last hour
    SELECT service_id INTO v_most_used_service
    FROM public.keymaker_access_log
    WHERE user_id = p_user_id
      AND allowed = true
      AND timestamp > now() - interval '1 hour'
    GROUP BY service_id
    ORDER BY COUNT(*) DESC
    LIMIT 1;
    
    IF v_most_used_service IS NOT NULL THEN
        v_prediction := v_most_used_service;
        v_confidence := 0.7;
    ELSE
        v_prediction := 'unknown';
        v_confidence := 0.0;
    END IF;
    
    RETURN jsonb_build_object(
        'predicted_service', v_prediction,
        'confidence', v_confidence,
        'based_on', 'recent_usage_pattern'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- AGENT (JOB QUEUE) FUNCTIONS
-- ============================================================================

-- Function: Create a job
CREATE OR REPLACE FUNCTION public.agent_create_job(
    p_job_type TEXT,
    p_payload JSONB,
    p_priority INTEGER DEFAULT 0,
    p_target_service TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
    v_job_id TEXT;
    v_execution_path TEXT;
    v_system_state RECORD;
BEGIN
    v_job_id := 'job_' || encode(gen_random_bytes(8), 'hex');
    
    -- Get system state for routing decision
    SELECT * INTO v_system_state FROM public.keymaker_system_state LIMIT 1;
    
    -- Determine execution path
    IF v_system_state.load_level = 'critical' THEN
        v_execution_path := 'queued';
    ELSIF p_priority >= 10 THEN
        v_execution_path := 'priority';
    ELSE
        v_execution_path := 'direct';
    END IF;
    
    INSERT INTO public.keymaker_jobs (
        job_id,
        job_type,
        payload,
        priority,
        target_service,
        execution_path,
        idempotency_key
    ) VALUES (
        v_job_id,
        p_job_type,
        p_payload,
        p_priority,
        p_target_service,
        v_execution_path,
        p_idempotency_key
    );
    
    RETURN v_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Claim next job (for workers)
CREATE OR REPLACE FUNCTION public.agent_claim_job(p_worker_id TEXT)
RETURNS JSONB AS $$
DECLARE
    v_job RECORD;
BEGIN
    -- Find and lock next pending job
    SELECT * INTO v_job
    FROM public.keymaker_jobs
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY priority DESC, queued_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    
    IF v_job IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Mark as running
    UPDATE public.keymaker_jobs
    SET status = 'running',
        started_at = now(),
        worker_id = p_worker_id
    WHERE id = v_job.id;
    
    RETURN jsonb_build_object(
        'job_id', v_job.job_id,
        'job_type', v_job.job_type,
        'payload', v_job.payload,
        'priority', v_job.priority
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Complete a job
CREATE OR REPLACE FUNCTION public.agent_complete_job(
    p_job_id TEXT,
    p_status TEXT,  -- completed, failed
    p_result JSONB DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE public.keymaker_jobs
    SET status = p_status,
        completed_at = now(),
        result = p_result,
        error_message = p_error_message
    WHERE job_id = p_job_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Retry failed jobs
CREATE OR REPLACE FUNCTION public.agent_retry_failed_jobs()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    v_job RECORD;
BEGIN
    FOR v_job IN
        SELECT * FROM public.keymaker_jobs
        WHERE status = 'failed'
          AND retry_count < max_retries
          AND (next_retry_at IS NULL OR next_retry_at <= now())
    LOOP
        UPDATE public.keymaker_jobs
        SET status = 'pending',
            retry_count = retry_count + 1,
            next_retry_at = now() + (retry_count || ' minutes')::interval
        WHERE id = v_job.id;
        
        v_count := v_count + 1;
    END LOOP;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- NEO (ADMIN) FUNCTIONS
-- ============================================================================

-- Function: Emergency kill switch
CREATE OR REPLACE FUNCTION public.neo_kill_switch(p_enabled BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE public.keymaker_system_state
    SET automation_enabled = NOT p_enabled,
        emergency_override = p_enabled,
        updated_at = now()
    WHERE id = 1;
    
    -- Log the emergency action
    INSERT INTO public.keymaker_events (
        event_id, type, source, severity, payload
    ) VALUES (
        'emergency_' || encode(gen_random_bytes(4), 'hex'),
        'emergency_override',
        'neo',
        'critical',
        jsonb_build_object(
            'enabled', p_enabled,
            'reason', p_reason,
            'triggered_by', auth.uid()
        )
    );
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Grant break-glass access
CREATE OR REPLACE FUNCTION public.neo_break_glass_access(
    p_user_id UUID,
    p_reason TEXT,
    p_duration_minutes INTEGER DEFAULT 60
)
RETURNS TEXT AS $$
DECLARE
    v_key_hash TEXT;
BEGIN
    -- Issue emergency key
    SELECT k.key_hash INTO v_key_hash
    FROM public.keymaker_issue_key(
        p_user_id,
        'admin',
        'enterprise',
        NULL,  -- All services
        ARRAY['read', 'write', 'admin'],
        p_duration_minutes / 60,
        jsonb_build_object('break_glass', true, 'reason', p_reason)
    ) k;
    
    -- Mark as break-glass
    UPDATE public.keymaker_keys
    SET break_glass = true,
        issued_by = auth.uid()
    WHERE key_hash = v_key_hash;
    
    -- Log
    INSERT INTO public.keymaker_events (
        event_id, type, source, severity, payload
    ) VALUES (
        'breakglass_' || encode(gen_random_bytes(4), 'hex'),
        'break_glass_issued',
        'neo',
        'warning',
        jsonb_build_object(
            'to_user', p_user_id,
            'by_user', auth.uid(),
            'reason', p_reason,
            'duration_minutes', p_duration_minutes
        )
    );
    
    RETURN v_key_hash;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- OBSERVABILITY VIEWS
-- ============================================================================

-- View: Current system status
CREATE OR REPLACE VIEW public.v_keymaker_status AS
SELECT 
    s.load_level,
    s.health_status,
    s.maintenance_mode,
    s.active_requests,
    s.queue_depth,
    s.automation_enabled,
    s.emergency_override,
    (SELECT COUNT(*) FROM public.keymaker_keys WHERE revoked_at IS NULL AND expires_at > now()) as active_keys,
    (SELECT COUNT(*) FROM public.keymaker_jobs WHERE status = 'pending') as pending_jobs,
    (SELECT COUNT(*) FROM public.keymaker_jobs WHERE status = 'running') as running_jobs,
    (SELECT COUNT(*) FROM public.keymaker_jobs WHERE status = 'dead_letter') as dead_letter_jobs,
    (SELECT COUNT(*) FROM public.keymaker_access_log WHERE timestamp > now() - interval '1 hour') as requests_last_hour,
    (SELECT COUNT(*) FROM public.keymaker_access_log WHERE allowed = false AND timestamp > now() - interval '1 hour') as denied_last_hour
FROM public.keymaker_system_state s;

-- View: Access audit trail
CREATE OR REPLACE VIEW public.v_keymaker_audit AS
SELECT 
    al.request_id,
    al.timestamp,
    al.user_id,
    u.email as user_email,
    al.role,
    al.tier,
    al.service_id,
    s.name as service_name,
    al.path,
    al.method,
    al.allowed,
    al.reason,
    al.conditions_evaluated,
    al.system_load,
    al.system_health,
    al.decision_time_ms
FROM public.keymaker_access_log al
LEFT JOIN auth.users u ON al.user_id = u.id
LEFT JOIN public.keymaker_services s ON al.service_id = s.service_id
ORDER BY al.timestamp DESC;

-- View: User behavior analysis (Oracle's view)
CREATE OR REPLACE VIEW public.v_oracle_user_patterns AS
SELECT 
    user_id,
    count(*) as total_requests_24h,
    count(*) FILTER (WHERE allowed = false) as denied_requests,
    count(DISTINCT service_id) as services_accessed,
    mode() WITHIN GROUP (ORDER BY service_id) as most_used_service,
    avg(decision_time_ms) FILTER (WHERE decision_time_ms IS NOT NULL) as avg_latency_ms
FROM public.keymaker_access_log
WHERE timestamp > now() - interval '24 hours'
GROUP BY user_id;
