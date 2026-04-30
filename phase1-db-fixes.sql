-- PHASE 1 — DATABASE FIXES

-- 1. Ensure pgcrypto is installed
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- 2. Fix functions with gen_random_bytes
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

-- 3. Check for other functions using gen_random_bytes
SELECT 
    proname as function_name,
    'NEEDS FIX' as status
FROM pg_proc 
WHERE pg_get_functiondef(oid) LIKE '%gen_random_bytes%'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND proname != 'publish_event';
