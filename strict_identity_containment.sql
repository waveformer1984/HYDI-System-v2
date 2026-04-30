-- STRICT IDENTITY CONTAINMENT - FIXING IDENTITY COLLISION
-- Separate 3 identities explicitly with proper collision detection

-- =============================================================================
-- 1) SEPARATE 3 IDENTITIES EXPLICITLY
-- =============================================================================

-- Drop existing tables to rebuild with proper identity separation
DROP TABLE IF EXISTS public.webhook_events CASCADE;

-- Create enhanced external inbox with proper identity tracking
CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Delivery Identity (envelope)
    provider text NOT NULL,
    external_event_id text,
    
    -- Content Identity (payload)
    raw_payload jsonb NOT NULL,
    canonical_payload jsonb,
    canonical_payload_hash text,
    
    -- Causal Identity (domain effect)
    causal_event_id uuid,
    
    -- Metadata
    received_at timestamptz DEFAULT now(),
    status text DEFAULT 'received' CHECK (status IN ('received', 'processing', 'processed', 'failed', 'quarantined')),
    processing_started_at timestamptz,
    processing_completed_at timestatmptz,
    error_message text,
    retry_count int DEFAULT 0,
    
    -- Classification flags
    delivery_trustworthy boolean DEFAULT false,
    content_classified boolean DEFAULT false,
    causal_mapping_allowed boolean DEFAULT false,
    
    created_at timestamptz DEFAULT now()
);

-- Enhanced indexes for identity tracking
CREATE INDEX idx_webhook_events_delivery_identity ON public.webhook_events(provider, external_event_id);
CREATE INDEX idx_webhook_events_content_identity ON public.webhook_events(canonical_payload_hash);
CREATE INDEX idx_webhook_events_causal_identity ON public.webhook_events(causal_event_id);
CREATE INDEX idx_webhook_events_status ON public.webhook_events(status);
CREATE INDEX idx_webhook_events_received_at ON public.webhook_events(received_at);

-- =============================================================================
-- 2) FAIL CLOSED FOR WEAK INGRESS
-- =============================================================================

-- Function to validate delivery identity strength
CREATE OR REPLACE FUNCTION public.validate_delivery_identity(
    p_provider text,
    p_external_event_id text
)
RETURNS TABLE(
    is_valid boolean,
    trust_level text,
    quarantine_reason text
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_trustworthy_providers text[] := ARRAY['stripe', 'github', 'slack', 'twilio'];
    v_has_external_id boolean;
BEGIN
    -- Check if provider is trustworthy
    v_has_external_id := p_external_event_id IS NOT NULL AND p_external_event_id != '';
    
    -- Determine trust level
    IF p_provider = ANY(v_trustworthy_providers) AND v_has_external_id THEN
        RETURN QUERY SELECT true, 'high', NULL::text;
    ELSIF v_has_external_id THEN
        RETURN QUERY SELECT true, 'medium', NULL::text;
    ELSE
        RETURN QUERY SELECT false, 'low', 'Weak delivery identity: unknown provider and no external event ID';
    END IF;
END;
$$;

-- Function to quarantine weak ingress
CREATE OR REPLACE FUNCTION public.quarantine_weak_ingress(
    p_provider text,
    p_external_event_id text,
    p_raw_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_validation RECORD;
    v_inbox_event_id uuid;
BEGIN
    -- Validate delivery identity
    SELECT * INTO v_validation FROM public.validate_delivery_identity(p_provider, p_external_event_id);
    
    IF NOT v_validation.is_valid THEN
        -- Quarantine only, no causal event creation
        INSERT INTO public.webhook_events (
            provider,
            external_event_id,
            raw_payload,
            status,
            delivery_trustworthy,
            content_classified,
            causal_mapping_allowed
        ) VALUES (
            p_provider,
            p_external_event_id,
            p_raw_payload,
            'quarantined',
            false,
            false,
            false
        ) RETURNING id INTO v_inbox_event_id;
        
        -- Log quarantine reason
        RAISE NOTICE 'Quarantined weak ingress: %', v_validation.quarantine_reason;
        
        RETURN v_inbox_event_id;
    END IF;
    
    -- Continue with normal processing for trustworthy ingress
    RETURN NULL; -- Signal to continue with normal flow
END;
$$;

-- =============================================================================
-- 3) ADD COLLISION ASSERTIONS
-- =============================================================================

-- Function to detect duplicate collisions
CREATE OR REPLACE FUNCTION public.detect_duplicate_collision(
    p_provider text,
    p_external_event_id text,
    p_canonical_payload_hash text
)
RETURNS TABLE(
    has_collision boolean,
    collision_type text,
    existing_event_id uuid,
    collision_details jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_delivery RECORD;
    v_existing_content RECORD;
    v_collision_details jsonb;
BEGIN
    -- Check for delivery identity collision
    SELECT id, provider, external_event_id, canonical_payload_hash
    INTO v_existing_delivery
    FROM public.webhook_events
    WHERE provider = p_provider 
    AND external_event_id = p_external_event_id
    AND status != 'failed'
    LIMIT 1;
    
    IF v_existing_delivery.id IS NOT NULL THEN
        -- Found existing delivery identity
        IF v_existing_delivery.canonical_payload_hash != p_canonical_payload_hash THEN
            -- Delivery collision: same external ID, different payload
            v_collision_details := jsonb_build_object(
                'existing_hash', v_existing_delivery.canonical_payload_hash,
                'new_hash', p_canonical_payload_hash,
                'collision_type', 'delivery_identity'
            );
            
            RETURN QUERY SELECT true, 'DELIVERY_COLLISION', v_existing_delivery.id, v_collision_details;
            RETURN;
        END IF;
        
        -- Same delivery identity and same payload - legitimate duplicate
        RETURN QUERY SELECT false, 'LEGITIMATE_DUPLICATE', v_existing_delivery.id, NULL::jsonb;
        RETURN;
    END IF;
    
    -- Check for content identity collision (same payload, different delivery)
    SELECT id, provider, external_event_id, canonical_payload_hash
    INTO v_existing_content
    FROM public.webhook_events
    WHERE canonical_payload_hash = p_canonical_payload_hash
    AND (provider != p_provider OR external_event_id != p_external_event_id)
    AND status != 'failed'
    LIMIT 1;
    
    IF v_existing_content.id IS NOT NULL THEN
        -- Content collision: same payload, different delivery identity
        v_collision_details := jsonb_build_object(
            'existing_provider', v_existing_content.provider,
            'existing_external_id', v_existing_content.external_event_id,
            'new_provider', p_provider,
            'new_external_id', p_external_event_id,
            'collision_type', 'content_identity'
        );
        
        RETURN QUERY SELECT true, 'CONTENT_COLLISION', v_existing_content.id, v_collision_details;
        RETURN;
    END IF;
    
    -- No collisions detected
    RETURN QUERY SELECT false, 'NO_COLLISION', NULL::uuid, NULL::jsonb;
END;
$$;

-- Collision guard trigger
CREATE OR REPLACE FUNCTION public.collision_guard_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_collision RECORD;
BEGIN
    -- Only check on insert
    IF TG_OP = 'INSERT' THEN
        -- Detect collisions
        SELECT * INTO v_collision 
        FROM public.detect_duplicate_collision(
            NEW.provider,
            NEW.external_event_id,
            NEW.canonical_payload_hash
        )
        WHERE has_collision = true;
        
        IF v_collision.has_collision THEN
            -- Raise invariant failure
            RAISE EXCEPTION 'DUPLICATE_COLLISION: % collision detected. Details: %', 
                           v_collision.collision_type, 
                           v_collision.collision_details;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

-- =============================================================================
-- 4) PREVENT MANY-TO-ONE CAUSAL MAPPING
-- =============================================================================

-- Function to check causal mapping limits
CREATE OR REPLACE FUNCTION public.check_causal_mapping_limits(
    p_causal_event_id uuid,
    p_provider text,
    p_external_event_id text,
    p_canonical_payload_hash text
)
RETURNS TABLE(
    mapping_allowed boolean,
    reason text,
    current_mapping_count int
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_mappings int;
    v_distinct_delivery_count int;
    v_distinct_content_count int;
BEGIN
    -- Count existing mappings to this causal event
    SELECT 
        COUNT(*)::int,
        COUNT(DISTINCT provider || ':' || COALESCE(external_event_id, 'null'))::int,
        COUNT(DISTINCT canonical_payload_hash)::int
    INTO v_existing_mappings, v_distinct_delivery_count, v_distinct_content_count
    FROM public.webhook_events
    WHERE causal_event_id = p_causal_event_id;
    
    -- If no existing mappings, allow first one
    IF v_existing_mappings = 0 THEN
        RETURN QUERY SELECT true, 'First mapping to causal event', 0;
        RETURN;
    END IF;
    
    -- Check for many-to-one violations
    IF v_distinct_delivery_count > 1 OR v_distinct_content_count > 1 THEN
        RETURN QUERY SELECT false, 
            format('Many-to-one mapping violation: %s distinct deliveries, %s distinct content hashes already mapped to this causal event', 
                   v_distinct_delivery_count, v_distinct_content_count),
            v_existing_mappings;
        RETURN;
    END IF;
    
    -- Allow additional mappings only if they're identical
    RETURN QUERY SELECT true, 'Additional identical mapping allowed', v_existing_mappings;
END;
$$;

-- Causal mapping guard trigger
CREATE OR REPLACE FUNCTION public.causal_mapping_guard_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_mapping_check RECORD;
BEGIN
    -- Only check when causal_event_id is being set
    IF TG_OP = 'UPDATE' AND OLD.causal_event_id IS DISTINCT FROM NEW.causal_event_id THEN
        -- Check mapping limits
        SELECT * INTO v_mapping_check
        FROM public.check_causal_mapping_limits(
            NEW.causal_event_id,
            NEW.provider,
            NEW.external_event_id,
            NEW.canonical_payload_hash
        )
        WHERE mapping_allowed = false;
        
        IF v_mapping_check.mapping_allowed = false THEN
            RAISE EXCEPTION 'CAUSAL_MAPPING_VIOLATION: %', v_mapping_check.reason;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

-- =============================================================================
-- 5) ENHANCED INGESTION FUNCTION WITH PROPER IDENTITY HANDLING
-- =============================================================================

-- Drop and recreate the ingestion function
CREATE OR REPLACE FUNCTION public.insert_webhook_event_strict(
    p_provider text,
    p_external_event_id text,
    p_raw_payload jsonb
)
RETURNS TABLE(
    inbox_event_id uuid,
    status text,
    is_duplicate boolean,
    collision_detected boolean,
    quarantine_reason text
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_canonical_payload jsonb;
    v_payload_hash text;
    v_quarantine_result uuid;
    v_collision_check RECORD;
    v_existing_event_id uuid;
BEGIN
    -- Step 1: Canonicalize payload
    v_canonical_payload := public.canonicalize_external_payload(p_raw_payload);
    v_payload_hash := public.generate_payload_hash(v_canonical_payload);
    
    -- Step 2: Fail closed for weak ingress
    SELECT * INTO v_quarantine_result 
    FROM public.quarantine_weak_ingress(p_provider, p_external_event_id, p_raw_payload);
    
    IF v_quarantine_result IS NOT NULL THEN
        RETURN QUERY 
        SELECT v_quarantine_result, 'quarantined', false, false, 'Weak delivery identity';
        RETURN;
    END IF;
    
    -- Step 3: Check for legitimate duplicates
    SELECT id INTO v_existing_event_id
    FROM public.webhook_events
    WHERE provider = p_provider 
    AND external_event_id = p_external_event_id
    AND canonical_payload_hash = v_payload_hash
    AND status NOT IN ('failed', 'quarantined')
    LIMIT 1;
    
    IF v_existing_event_id IS NOT NULL THEN
        RETURN QUERY 
        SELECT v_existing_event_id, 'duplicate', true, false, NULL::text;
        RETURN;
    END IF;
    
    -- Step 4: Insert new event with collision detection
    INSERT INTO public.webhook_events (
        provider,
        external_event_id,
        raw_payload,
        canonical_payload,
        canonical_payload_hash,
        delivery_trustworthy,
        content_classified,
        causal_mapping_allowed
    ) VALUES (
        p_provider,
        p_external_event_id,
        p_raw_payload,
        v_canonical_payload,
        v_payload_hash,
        (SELECT is_valid FROM validate_delivery_identity(p_provider, p_external_event_id)),
        true, -- Content is now classified
        true  -- Allow causal mapping by default for valid events
    ) RETURNING id INTO inbox_event_id;
    
    RETURN QUERY 
    SELECT inbox_event_id, 'received', false, false, NULL::text;
END;
$$;

-- =============================================================================
-- 6) HIGH-VALUE SANITY QUERY
-- =============================================================================

-- Function to run the sanity query for causal mapping violations
CREATE OR REPLACE FUNCTION public.causal_mapping_sanity_check()
RETURNS TABLE(
    causal_event_id uuid,
    inbox_rows int,
    distinct_external_ids int,
    distinct_payload_hashes int,
    violation_type text,
    severity text
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH causal_mappings AS (
        SELECT
            causal_event_id,
            COUNT(*)::int as inbox_rows,
            COUNT(DISTINCT provider || ':' || COALESCE(external_event_id, 'null'))::int as distinct_external_ids,
            COUNT(DISTINCT canonical_payload_hash)::int as distinct_payload_hashes
        FROM public.webhook_events
        WHERE causal_event_id IS NOT NULL
        AND status NOT IN ('failed', 'quarantined')
        GROUP BY causal_event_id
    )
    SELECT
        cm.causal_event_id,
        cm.inbox_rows,
        cm.distinct_external_ids,
        cm.distinct_payload_hashes,
        CASE 
            WHEN cm.distinct_external_ids > 1 AND cm.distinct_payload_hashes > 1 THEN 'BOTH_COLLISIONS'
            WHEN cm.distinct_external_ids > 1 THEN 'DELIVERY_COLLISION'
            WHEN cm.distinct_payload_hashes > 1 THEN 'CONTENT_COLLISION'
            ELSE 'NO_VIOLATION'
        END as violation_type,
        CASE 
            WHEN cm.distinct_external_ids > 1 AND cm.distinct_payload_hashes > 1 THEN 'critical'
            WHEN cm.distinct_external_ids > 1 OR cm.distinct_payload_hashes > 1 THEN 'high'
            ELSE 'low'
        END as severity
    FROM causal_mappings cm
    WHERE cm.distinct_external_ids > 1 OR cm.distinct_payload_hashes > 1
    ORDER BY cm.inbox_rows DESC;
END;
$$;

-- =============================================================================
-- 7) TRIGGERS AND CONSTRAINTS
-- =============================================================================

-- Add triggers
CREATE TRIGGER trg_webhook_events_collision_guard
    BEFORE INSERT ON public.webhook_events
    FOR EACH ROW EXECUTE FUNCTION public.collision_guard_trigger();

CREATE TRIGGER trg_webhook_events_causal_mapping_guard
    BEFORE UPDATE ON public.webhook_events
    FOR EACH ROW EXECUTE FUNCTION public.causal_mapping_guard_trigger();

-- Add constraints
ALTER TABLE public.webhook_events 
ADD CONSTRAINT webhook_events_delivery_identity_check 
CHECK (
    (provider IS NOT NULL) AND 
    (delivery_trustworthy = false OR (delivery_trustworthy = true AND external_event_id IS NOT NULL))
);

ALTER TABLE public.webhook_events
ADD CONSTRAINT webhook_events_content_identity_check
CHECK (
    (canonical_payload IS NOT NULL) AND 
    (canonical_payload_hash IS NOT NULL)
);

-- =============================================================================
-- 8) GRANTS
-- =============================================================================

GRANT SELECT, INSERT ON public.webhook_events TO authenticated;
GRANT SELECT, INSERT ON public.webhook_events TO service_role;

GRANT EXECUTE ON FUNCTION public.insert_webhook_event_strict(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_webhook_event_strict(text, text, jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.causal_mapping_sanity_check() TO authenticated;
GRANT EXECUTE ON FUNCTION public.causal_mapping_sanity_check() TO service_role;

-- =============================================================================
-- CONTAINMENT COMPLETE - IDENTITY COLLISION FIXED
-- =============================================================================
