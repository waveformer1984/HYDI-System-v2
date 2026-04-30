-- Add notification function to chat operator system
-- This allows tool-executor to send notifications when actions complete

-- Tool: Send Notification
CREATE OR REPLACE FUNCTION public.tool_send_notification(
  p_requested_by uuid,
  p_input jsonb
) RETURNS boolean AS $$
DECLARE
  v_recipient text;
  v_channel text;
  v_template text;
  v_type text;
  v_data jsonb;
  v_notification_url text;
  v_response jsonb;
BEGIN
  -- Extract parameters from input
  v_recipient := p_input->>'recipient';
  v_channel := p_input->>'channel';
  v_template := p_input->>'template';
  v_type := p_input->>'type';
  v_data := COALESCE(p_input->'data', '{}'::jsonb);
  
  -- Validate inputs
  IF v_recipient IS NULL OR v_channel IS NULL OR v_template IS NULL THEN
    RAISE EXCEPTION 'Invalid notification parameters: recipient, channel, and template required';
  END IF;
  
  IF v_channel NOT IN ('sms', 'email') THEN
    RAISE EXCEPTION 'Invalid channel: must be sms or email';
  END IF;
  
  -- Get notification service URL
  v_notification_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/notification-service';
  
  -- Call notification service via pg_net
  SELECT net.http_post(
    url := v_notification_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_jwt', true),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'type', COALESCE(v_type, 'system'),
      'recipient', v_recipient,
      'channel', v_channel,
      'template', v_template,
      'data', v_data
    )
  ) INTO v_response;
  
  -- Log the action for audit
  INSERT INTO public.operator_actions (
    conversation_id,
    requested_by,
    action_name,
    action_input,
    action_status,
    action_output
  ) VALUES (
    NULL, -- Will be set by caller
    p_requested_by,
    'tool_send_notification',
    p_input,
    'success',
    jsonb_build_object(
      'recipient', v_recipient,
      'channel', v_channel,
      'template', v_template,
      'notification_sent', true
    )
  );
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to service role for execution
GRANT EXECUTE ON FUNCTION public.tool_send_notification TO service_role;

-- Add notification sending to tool-executor workflow
-- This will be called automatically when actions complete
CREATE OR REPLACE FUNCTION public.send_completion_notification(
  p_conversation_id uuid,
  p_action_name text,
  p_status text,
  p_output jsonb,
  p_user_phone text DEFAULT NULL,
  p_user_email text DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_notification_data jsonb;
BEGIN
  -- Only send notifications for successful actions
  IF p_status != 'success' THEN
    RETURN;
  END IF;
  
  -- Prepare notification data
  v_notification_data := jsonb_build_object(
    'action', p_action_name,
    'status', p_status,
    'completedAt', now()::text,
    'output', p_output
  );
  
  -- Send SMS notification if phone number available
  IF p_user_phone IS NOT NULL THEN
    PERFORM public.tool_send_notification(
      '00000000-0000-0000-0000-000000000000',
      jsonb_build_object(
        'type', 'action_completed',
        'recipient', p_user_phone,
        'channel', 'sms',
        'template', 'action_completed',
        'data', v_notification_data
      )
    );
  END IF;
  
  -- Send email notification if email available
  IF p_user_email IS NOT NULL THEN
    PERFORM public.tool_send_notification(
      '00000000-0000-0000-0000-000000000000',
      jsonb_build_object(
        'type', 'action_completed',
        'recipient', p_user_email,
        'channel', 'email',
        'template', 'action_completed',
        'data', v_notification_data
      )
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to service role for execution
GRANT EXECUTE ON FUNCTION public.send_completion_notification TO service_role;
