-- Secure RPC function ownership
ALTER FUNCTION public.claim_webhook_event(text, text) OWNER TO postgres;
