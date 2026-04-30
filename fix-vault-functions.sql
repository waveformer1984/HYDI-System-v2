-- Fix gen_random_bytes schema qualification issues
-- Run this in Supabase SQL Editor

-- Fix 1: provision_customer_services function
CREATE OR REPLACE FUNCTION public.provision_customer_services()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_customer_id uuid;
    v_plan text;
    v_service_name text := 'core_access';
    v_session_id text := encode(extensions.gen_random_bytes(16), 'hex');
BEGIN
    -- Get latest completed revenue job
    SELECT (payload->>'customer_id')::uuid, (payload->>'plan')
    INTO v_customer_id, v_plan
    FROM public.worker_jobs
    WHERE queue_name = 'revenue'
      AND status = 'done'
      AND payload ? 'customer_id'
      AND payload ? 'plan'
    ORDER BY completed_at DESC
    LIMIT 1;

    IF v_customer_id IS NOT NULL THEN
        -- Provision service
        INSERT INTO public.customer_services (
            customer_id,
            service_name,
            status,
            metadata,
            created_at,
            updated_at
        ) VALUES (
            v_customer_id,
            v_service_name,
            'active',
            jsonb_build_object(
                'plan', v_plan,
                'session_id', v_session_id,
                'provisioned_at', now()
            ),
            now(),
            now()
        ) ON CONFLICT (customer_id, service_name) DO UPDATE SET
            status = EXCLUDED.status,
            metadata = EXCLUDED.metadata,
            updated_at = now();

        -- Publish event
        PERFORM public.publish_event(
            'provisioning:services',
            'service_provisioned',
            jsonb_build_object(
                'customer_id', v_customer_id,
                'service_name', v_service_name,
                'plan', v_plan,
                'session_id', v_session_id
            )
        );
    END IF;
END;
$$;

-- Fix 2: publish_event function
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
    v_event_id uuid := encode(extensions.gen_random_bytes(16), 'hex')::uuid;
    v_event_key text := p_topic || ':' || p_event_name || ':' || v_event_id::text;
BEGIN
    -- Insert event
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

    -- Trigger realtime broadcast (via trigger)
    RETURN v_event_id;
END;
$$;

-- Verify the fixes
SELECT 
    'publish_event' as function_name,
    proname as fixed
FROM pg_proc 
WHERE proname = 'publish_event'
   AND pg_get_functiondef(oid) LIKE '%extensions.gen_random_bytes%'

UNION ALL

SELECT 
    'provision_customer_services' as function_name,
    proname as fixed
FROM pg_proc 
WHERE proname = 'provision_customer_services'
   AND pg_get_functiondef(oid) LIKE '%extensions.gen_random_bytes%';
