-- ============================================================================
-- KEYMAKER CORE SCHEMA
-- Access, Routing, and Permission Management
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ============================================================================
-- 1. SERVICE REGISTRY (The "Doors")
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.keymaker_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    
    -- Access control
    allowed_roles TEXT[] DEFAULT ARRAY['admin'],
    required_permissions TEXT[] DEFAULT '{}',
    
    -- Tier gating (starter, pro, enterprise)
    min_tier TEXT DEFAULT 'starter',
    
    -- Dynamic conditions
    conditions JSONB DEFAULT '[]',
    
    -- Endpoint mapping
    base_path TEXT NOT NULL,
    methods TEXT[] DEFAULT ARRAY['GET'],
    
    -- Rate limiting
    rate_limit JSONB DEFAULT '{"requests_per_minute": 60}'::jsonb,
    
    -- Status
    enabled BOOLEAN DEFAULT true,
    maintenance_mode BOOLEAN DEFAULT false,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE public.keymaker_services IS 'Registry of all services/endpoints - The Keymaker''s "doors"';

-- ============================================================================
-- 2. ACCESS KEYS (Temporary tokens issued by Keymaker)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.keymaker_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Key identification
    key_hash TEXT UNIQUE NOT NULL,  -- SHA-256 of the actual key
    key_type TEXT DEFAULT 'access',  -- access, service, admin, emergency
    
    -- Identity
    user_id UUID REFERENCES auth.users(id),
    role TEXT DEFAULT 'guest',
    tier TEXT DEFAULT 'starter',
    subscription_id TEXT,
    
    -- Scope
    allowed_services TEXT[],
    scopes TEXT[] DEFAULT ARRAY['read'],
    
    -- Validity
    issued_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    
    -- Usage tracking
    use_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    
    -- Context (stored at creation)
    issued_from_ip INET,
    metadata JSONB DEFAULT '{}',
    
    -- For emergency/admin keys
    issued_by UUID REFERENCES auth.users(id),
    break_glass BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_keymaker_keys_user ON public.keymaker_keys(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_keymaker_keys_expires ON public.keymaker_keys(expires_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.keymaker_keys IS 'Issued keys/tokens - what the Keymaker hands out';

-- ============================================================================
-- 3. ACCESS LOG (Audit trail - who accessed what door, and why)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.keymaker_access_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Request details
    request_id TEXT UNIQUE NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT now(),
    
    -- Identity
    user_id UUID REFERENCES auth.users(id),
    role TEXT,
    tier TEXT,
    key_id UUID REFERENCES public.keymaker_keys(id),
    
    -- Service accessed
    service_id TEXT REFERENCES public.keymaker_services(service_id),
    path TEXT NOT NULL,
    method TEXT NOT NULL,
    
    -- Access decision
    allowed BOOLEAN NOT NULL,
    reason TEXT,  -- allowed, service_not_found, tier_too_low, condition_failed, etc.
    conditions_evaluated JSONB,
    
    -- System state at time of request
    system_load TEXT,
    system_health TEXT,
    
    -- Performance
    decision_time_ms INTEGER,
    
    -- Request metadata
    client_ip INET,
    user_agent TEXT,
    request_metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_access_log_user ON public.keymaker_access_log(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_service ON public.keymaker_access_log(service_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_timestamp ON public.keymaker_access_log(timestamp DESC);

COMMENT ON TABLE public.keymaker_access_log IS 'Complete audit trail - Neo can see everything';

-- ============================================================================
-- 4. SYSTEM STATE (For dynamic rule evaluation)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.keymaker_system_state (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- Singleton table
    
    load_level TEXT DEFAULT 'normal',  -- normal, elevated, critical
    health_status TEXT DEFAULT 'green',  -- green, yellow, red
    maintenance_mode BOOLEAN DEFAULT false,
    
    -- Metrics
    active_requests INTEGER DEFAULT 0,
    queue_depth INTEGER DEFAULT 0,
    error_rate_5m NUMERIC DEFAULT 0,
    
    -- Feature flags
    automation_enabled BOOLEAN DEFAULT true,
    emergency_override BOOLEAN DEFAULT false,
    
    -- Oracle predictions (cached)
    predicted_load TEXT,
    prediction_confidence NUMERIC,
    prediction_updated_at TIMESTAMPTZ,
    
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.keymaker_system_state (id) VALUES (1) ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.keymaker_system_state IS 'System state for dynamic rule evaluation - The Architect''s view';

-- ============================================================================
-- 5. EVENTS (The Oracle's input data)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.keymaker_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT UNIQUE NOT NULL,
    
    -- Event classification
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    severity TEXT DEFAULT 'info',  -- debug, info, warning, error, critical
    
    -- Content
    payload JSONB NOT NULL,
    
    -- Processing state
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMPTZ,
    processor_id TEXT,
    
    -- Oracle predictions
    predicted_outcome TEXT,
    prediction_confidence NUMERIC,
    actual_outcome TEXT,
    outcome_validated BOOLEAN,
    
    -- Cascade integration
    classification TEXT,
    confidence_score NUMERIC,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    occurred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_keymaker_events_type ON public.keymaker_events(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keymaker_events_unprocessed ON public.keymaker_events(processed) WHERE NOT processed;

COMMENT ON TABLE public.keymaker_events IS 'All system events - The Oracle learns from these';

-- ============================================================================
-- 6. JOB QUEUE (Agent Smith's work queue)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.keymaker_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id TEXT UNIQUE NOT NULL,
    
    -- Job definition
    job_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    priority INTEGER DEFAULT 0,  -- Higher = more urgent
    
    -- Routing
    target_service TEXT REFERENCES public.keymaker_services(service_id),
    execution_path TEXT DEFAULT 'direct',  -- direct, queued, priority, background
    
    -- Status machine
    status TEXT DEFAULT 'pending',  -- pending, running, completed, failed, dead_letter
    
    -- Execution tracking
    queued_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Retry logic
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    
    -- Result
    result JSONB,
    error_message TEXT,
    
    -- Worker info
    worker_id TEXT,
    
    -- Idempotency
    idempotency_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_keymaker_jobs_status ON public.keymaker_jobs(status, priority DESC, queued_at);
CREATE INDEX IF NOT EXISTS idx_keymaker_jobs_pending ON public.keymaker_jobs(status, next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_keymaker_jobs_type ON public.keymaker_jobs(job_type, status);

COMMENT ON TABLE public.keymaker_jobs IS 'Agent work queue - what Smith processes';

-- ============================================================================
-- 7. CONFIG TABLE (Neo override switches)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.keymaker_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES auth.users(id)
);

-- Default config values
INSERT INTO public.keymaker_config (key, value, description) VALUES
    ('automation_enabled', 'true', 'Master switch for autonomous agents'),
    ('emergency_mode', 'false', 'Emergency override active - Neo mode'),
    ('max_retry_attempts', '3', 'Default max retries for jobs'),
    ('rate_limit_multiplier', '1.0', 'Global rate limit multiplier'),
    ('oracle_enabled', 'true', 'Enable predictive routing'),
    ('maintenance_message', '"System undergoing maintenance"', 'Message shown during maintenance')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.keymaker_config IS 'System configuration - Neo can flip these switches';

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

ALTER TABLE public.keymaker_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keymaker_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keymaker_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keymaker_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keymaker_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keymaker_config ENABLE ROW LEVEL SECURITY;

-- Services: Read-only for all authenticated, admin can modify
DO $$ BEGIN
    CREATE POLICY "Services visible to authenticated"
        ON public.keymaker_services FOR SELECT
        TO authenticated USING (enabled = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Services admin only"
        ON public.keymaker_services FOR ALL
        TO authenticated
        USING (auth.jwt() ->> 'role' = 'admin')
        WITH CHECK (auth.jwt() ->> 'role' = 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Keys: Users can see only their own keys
DO $$ BEGIN
    CREATE POLICY "Users see own keys"
        ON public.keymaker_keys FOR SELECT
        TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Users create own keys"
        ON public.keymaker_keys FOR INSERT
        TO authenticated WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Admin sees all keys"
        ON public.keymaker_keys FOR ALL
        TO authenticated
        USING (auth.jwt() ->> 'role' = 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Access log: Users see their own, admin sees all
DO $$ BEGIN
    CREATE POLICY "Users see own access log"
        ON public.keymaker_access_log FOR SELECT
        TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Admin sees all access log"
        ON public.keymaker_access_log FOR SELECT
        TO authenticated USING (auth.jwt() ->> 'role' = 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Events: Read-only for authenticated, service role can insert
DO $$ BEGIN
    CREATE POLICY "Events readable by authenticated"
        ON public.keymaker_events FOR SELECT
        TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Events insertable by service"
        ON public.keymaker_events FOR INSERT
        TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Jobs: Users see their own jobs, workers see all pending
DO $$ BEGIN
    CREATE POLICY "Users see own jobs"
        ON public.keymaker_jobs FOR SELECT
        TO authenticated USING (
            (payload ->> 'user_id')::uuid = auth.uid() OR
            auth.jwt() ->> 'role' IN ('admin', 'worker', 'agent')
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Workers update jobs"
        ON public.keymaker_jobs FOR UPDATE
        TO authenticated
        USING (auth.jwt() ->> 'role' IN ('worker', 'agent', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Users create jobs"
        ON public.keymaker_jobs FOR INSERT
        TO authenticated WITH CHECK (
            (payload ->> 'user_id')::uuid = auth.uid() OR
            auth.jwt() ->> 'role' IN ('admin', 'service')
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Config: Admin only
DO $$ BEGIN
    CREATE POLICY "Config admin only"
        ON public.keymaker_config FOR ALL
        TO authenticated
        USING (auth.jwt() ->> 'role' = 'admin')
        WITH CHECK (auth.jwt() ->> 'role' = 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- System state: Admin only for write, readable by authenticated
DO $$ BEGIN
    CREATE POLICY "System state readable"
        ON public.keymaker_system_state FOR SELECT
        TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "System state admin write"
        ON public.keymaker_system_state FOR ALL
        TO authenticated
        USING (auth.jwt() ->> 'role' = 'admin')
        WITH CHECK (auth.jwt() ->> 'role' = 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
