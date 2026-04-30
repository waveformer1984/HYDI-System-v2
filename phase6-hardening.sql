-- PHASE 6 — HARDENING

-- 1. Fix invoke_worker_orchestrator function
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
    SELECT decrypted_secret INTO v_url 
    FROM vault.decrypted_secrets 
    WHERE name = 'project_url';
    
    SELECT decrypted_secret INTO v_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'service_role_key';
    
    IF v_url IS NULL OR v_key IS NULL THEN
        RETURN NULL;
    END IF;
    
    SELECT net.http_post(
        url := v_url || '/functions/v1/worker-orchestrator',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object(
            'queue_name', p_queue_name,
            'batch_size', p_batch_size
        )
    ) INTO v_request_id;
    
    RETURN v_request_id;
END;
$$;

-- 2. Ensure RLS is properly configured
ALTER TABLE worker_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_bus_events ENABLE ROW LEVEL SECURITY;

-- 3. Create policies for service role only
CREATE POLICY IF NOT EXISTS "Service role full access" ON worker_jobs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role full access" ON worker_failures
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role full access" ON event_bus_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);
