-- RPC Functions for tool-executor Edge Function
-- These functions match the expected signatures in tool-executor

-- Tool: Create Invoice
CREATE OR REPLACE FUNCTION public.tool_create_invoice(
  p_requested_by uuid,
  p_input jsonb
) RETURNS uuid AS $$
DECLARE
  v_invoice_id uuid;
  v_customer_id uuid;
  v_amount_cents int;
  v_note text;
BEGIN
  -- Extract parameters from input
  v_customer_id := (p_input->>'customer_id')::uuid;
  v_amount_cents := (p_input->>'amount_cents')::int;
  v_note := p_input->>'note';
  
  -- Validate inputs
  IF v_customer_id IS NULL OR v_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Invalid invoice parameters: customer_id and amount_cents required';
  END IF;
  
  -- Create invoice (would integrate with actual billing system)
  v_invoice_id := gen_random_uuid();
  
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
    'tool_create_invoice',
    p_input,
    'success',
    jsonb_build_object('invoice_id', v_invoice_id, 'amount_cents', v_amount_cents)
  );
  
  RETURN v_invoice_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Tool: Pause Subscription
CREATE OR REPLACE FUNCTION public.tool_pause_subscription(
  p_requested_by uuid,
  p_input jsonb
) RETURNS boolean AS $$
DECLARE
  v_subscription_id text;
  v_reason text;
  v_success boolean := false;
BEGIN
  -- Extract parameters from input
  v_subscription_id := p_input->>'subscription_id';
  v_reason := p_input->>'reason';
  
  -- Validate input
  IF v_subscription_id IS NULL OR v_subscription_id = '' THEN
    RAISE EXCEPTION 'Invalid subscription_id parameter';
  END IF;
  
  -- Pause subscription (would integrate with actual subscription system)
  v_success := true;
  
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
    'tool_pause_subscription',
    p_input,
    'success',
    jsonb_build_object('subscription_id', v_subscription_id, 'paused', v_success, 'reason', v_reason)
  );
  
  RETURN v_success;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Tool: Create Support Ticket
CREATE OR REPLACE FUNCTION public.tool_create_support_ticket(
  p_requested_by uuid,
  p_input jsonb
) RETURNS uuid AS $$
DECLARE
  v_ticket_id uuid;
  v_subject text;
  v_body text;
  v_priority text;
BEGIN
  -- Extract parameters from input
  v_subject := p_input->>'subject';
  v_body := p_input->>'body';
  v_priority := COALESCE(p_input->>'priority', 'normal');
  
  -- Validate inputs
  IF v_subject IS NULL OR v_body IS NULL THEN
    RAISE EXCEPTION 'Subject and body are required parameters';
  END IF;
  
  -- Create ticket (would integrate with actual ticketing system)
  v_ticket_id := gen_random_uuid();
  
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
    'tool_create_support_ticket',
    p_input,
    'success',
    jsonb_build_object('ticket_id', v_ticket_id, 'subject', v_subject, 'priority', v_priority)
  );
  
  RETURN v_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to service role for execution
GRANT EXECUTE ON FUNCTION public.tool_create_invoice TO service_role;
GRANT EXECUTE ON FUNCTION public.tool_pause_subscription TO service_role;
GRANT EXECUTE ON FUNCTION public.tool_create_support_ticket TO service_role;
