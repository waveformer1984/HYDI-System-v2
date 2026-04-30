-- Database Functions for Chat Operator System
-- Safe, auditable actions in Postgres

-- Function to create a support ticket
CREATE OR REPLACE FUNCTION create_ticket(
    p_user_id UUID,
    p_session_id UUID,
    p_ticket_data JSONB
) RETURNS UUID AS $$
BEGIN
    -- Verify user permissions
    IF NOT EXISTS (
        SELECT 1 FROM user_permissions 
        WHERE user_id = p_user_id 
        AND permission_type = 'create_ticket'
        AND (expires_at IS NULL OR expires_at > NOW())
    ) THEN
        RAISE EXCEPTION 'permission_denied', 'User does not have create_ticket permission';
    END IF;
    
    -- Create ticket record (would integrate with external ticketing system)
    INSERT INTO operator_actions (
        session_id,
        operator_id,
        action_type,
        action_data,
        status
    ) VALUES (
        p_session_id,
        p_user_id,
        'create_ticket',
        p_ticket_data,
        'completed'
    ) RETURNING id;
    
    -- Broadcast ticket creation
    INSERT INTO chat_events (
        session_id,
        user_id,
        event_type,
        content,
        metadata
    ) VALUES (
        p_session_id,
        p_user_id,
        'operator_action',
        jsonb_build_object(
            'action', 'ticket_created',
            'ticket_id', currval('operator_actions.id'),
            'ticket_data', p_ticket_data
        ),
        jsonb_build_object(
            'operator_id', p_user_id
        )
    );
    
    RETURN currval('operator_actions.id');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to issue a refund
CREATE OR REPLACE FUNCTION issue_refund(
    p_operator_id UUID,
    p_session_id UUID,
    p_refund_data JSONB
) RETURNS UUID AS $$
DECLARE
    v_refund_id UUID;
BEGIN
    -- Validate refund data
    IF p_refund_data->>'amount' IS NULL OR p_refund_data->>'payment_id' IS NULL THEN
        RAISE EXCEPTION 'invalid_data', 'Refund amount and payment_id are required';
    END IF;
    
    -- Create refund record
    INSERT INTO operator_actions (
        session_id,
        operator_id,
        action_type,
        action_data,
        status
    ) VALUES (
        p_session_id,
        p_operator_id,
        'issue_refund',
        p_refund_data,
        'completed'
    ) RETURNING id;
    
    v_refund_id := currval('operator_actions.id');
    
    -- Broadcast refund action
    INSERT INTO chat_events (
        session_id,
        user_id,
        event_type,
        content,
        metadata
    ) VALUES (
        p_session_id,
        (SELECT user_id FROM chat_sessions WHERE id = p_session_id),
        'operator_action',
        jsonb_build_object(
            'action', 'refund_issued',
            'refund_id', v_refund_id,
            'amount', p_refund_data->>'amount',
            'payment_id', p_refund_data->>'payment_id'
        ),
        jsonb_build_object(
            'operator_id', p_operator_id
        )
    );
    
    RETURN v_refund_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to run workflow step
CREATE OR REPLACE FUNCTION run_workflow_step(
    p_operator_id UUID,
    p_session_id UUID,
    p_workflow_data JSONB
) RETURNS UUID AS $$
DECLARE
    v_step_id UUID;
    v_workflow_type TEXT;
BEGIN
    -- Extract workflow type
    v_workflow_type := p_workflow_data->>'workflow_type';
    
    -- Validate workflow type
    IF v_workflow_type NOT IN ('escalation', 'handoff', 'follow_up', 'research') THEN
        RAISE EXCEPTION 'invalid_workflow', 'Invalid workflow_type';
    END IF;
    
    -- Create workflow step record
    INSERT INTO operator_actions (
        session_id,
        operator_id,
        action_type,
        action_data,
        status
    ) VALUES (
        p_session_id,
        p_operator_id,
        'run_workflow_step',
        p_workflow_data,
        'completed'
    ) RETURNING id;
    
    v_step_id := currval('operator_actions.id');
    
    -- Broadcast workflow step
    INSERT INTO chat_events (
        session_id,
        user_id,
        event_type,
        content,
        metadata
    ) VALUES (
        p_session_id,
        (SELECT user_id FROM chat_sessions WHERE id = p_session_id),
        'operator_action',
        jsonb_build_object(
            'action', 'workflow_step',
            'step_id', v_step_id,
            'workflow_type', v_workflow_type,
            'workflow_data', p_workflow_data
        ),
        jsonb_build_object(
            'operator_id', p_operator_id
        )
    );
    
    -- Queue async job if needed
    IF p_workflow_data->>'async' = true THEN
        INSERT INTO job_queue (
            job_type,
            job_data,
            status,
            scheduled_at
        ) VALUES (
            'workflow_' || v_workflow_type,
            jsonb_build_object(
                'step_id', v_step_id,
                'session_id', p_session_id,
                'operator_id', p_operator_id,
                'workflow_data', p_workflow_data
            ),
            'pending',
            NOW()
        );
    END IF;
    
    RETURN v_step_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to queue async job
CREATE OR REPLACE FUNCTION queue_job(
    p_job_type TEXT,
    p_job_data JSONB,
    p_scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    p_max_retries INTEGER DEFAULT 3
) RETURNS UUID AS $$
BEGIN
    -- Validate job type
    IF p_job_type NOT IN ('report_generation', 'data_export', 'email_notification', 'webhook_call') THEN
        RAISE EXCEPTION 'invalid_job', 'Invalid job type';
    END IF;
    
    -- Queue the job
    INSERT INTO job_queue (
        job_type,
        job_data,
        status,
        max_retries,
        scheduled_at
    ) VALUES (
        p_job_type,
        p_job_data,
        'pending',
        p_max_retries,
        p_scheduled_at
    ) RETURNING id;
    
    RETURN currval('job_queue.id');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user permissions
CREATE OR REPLACE FUNCTION get_user_permissions(
    p_user_id UUID
) RETURNS TABLE (
    permission_type TEXT,
    resource_id UUID,
    granted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        permission_type,
        resource_id,
        granted_at,
        expires_at
    FROM user_permissions
    WHERE user_id = p_user_id
    AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY granted_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get session details
CREATE OR REPLACE FUNCTION get_session_details(
    p_session_id UUID
) RETURNS TABLE (
    id UUID,
    user_id UUID,
    status TEXT,
    operator_id UUID,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        id,
        user_id,
        status,
        operator_id,
        started_at,
        ended_at,
        metadata
    FROM chat_sessions
    WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get chat history
CREATE OR REPLACE FUNCTION get_chat_history(
    p_session_id UUID,
    p_limit INTEGER DEFAULT 50
) RETURNS TABLE (
    id UUID,
    sender_type TEXT,
    sender_id UUID,
    content TEXT,
    message_type TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        id,
        sender_type,
        sender_id,
        content,
        message_type,
        metadata,
        created_at
    FROM chat_messages
    WHERE session_id = p_session_id
    ORDER BY created_at ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant usage to authenticated users
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
