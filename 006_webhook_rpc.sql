-- =====================================================
-- WEBHOOK EVENT CLAIM RPC FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION public.claim_webhook_event(p_event_id text, p_type text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.webhook_events (event_id, type, status)
  VALUES (p_event_id, p_type, 'processing')
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id; -- NULL means duplicate/already claimed
END;
$$;
