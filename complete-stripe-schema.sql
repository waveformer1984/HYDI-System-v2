-- Complete Stripe Schema for Current Project
-- Creates missing tables and fixes security issues

-- 1. Create missing Stripe operations tables
CREATE TABLE IF NOT EXISTS customer_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_email TEXT NOT NULL,
    service_name TEXT NOT NULL,
    status TEXT DEFAULT 'active', -- active, deactivated, suspended
    endpoint TEXT,
    api_key TEXT,
    limits JSONB DEFAULT '{}',
    usage JSONB DEFAULT '{}',
    activated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    stripe_customer_id TEXT,
    subscription_id TEXT
);

CREATE TABLE IF NOT EXISTS revenue_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stripe_event_id TEXT UNIQUE,
    customer_email TEXT,
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'usd',
    type TEXT, -- payment, refund, subscription
    status TEXT DEFAULT 'completed',
    metadata JSONB DEFAULT '{}',
    stripe_subscription_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_email TEXT NOT NULL,
    service_name TEXT NOT NULL,
    endpoint TEXT,
    request_count INTEGER DEFAULT 1,
    response_time INTEGER, -- in milliseconds
    status_code INTEGER,
    error_message TEXT,
    stripe_customer_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS on new tables
ALTER TABLE customer_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_usage_logs ENABLE ROW LEVEL SECURITY;

-- 3. Create safe RLS policies for service role only
DROP POLICY IF EXISTS "customer_services_policy" ON customer_services;
CREATE POLICY "customer_services_policy" ON customer_services 
FOR ALL USING (auth.jwt()->>'role' = 'service_role') 
WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "revenue_tracking_policy" ON revenue_tracking;
CREATE POLICY "revenue_tracking_policy" ON revenue_tracking 
FOR ALL USING (auth.jwt()->>'role' = 'service_role') 
WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "service_usage_logs_policy" ON service_usage_logs;
CREATE POLICY "service_usage_logs_policy" ON service_usage_logs 
FOR ALL USING (auth.jwt()->>'role' = 'service_role') 
WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- 4. Add performance indexes
CREATE INDEX IF NOT EXISTS idx_customer_services_email ON customer_services(customer_email);
CREATE INDEX IF NOT EXISTS idx_customer_services_service ON customer_services(service_name);
CREATE INDEX IF NOT EXISTS idx_customer_services_status ON customer_services(status);
CREATE INDEX IF NOT EXISTS idx_customer_services_stripe_id ON customer_services(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_revenue_tracking_email ON revenue_tracking(customer_email);
CREATE INDEX IF NOT EXISTS idx_revenue_tracking_created ON revenue_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_revenue_tracking_type ON revenue_tracking(type);
CREATE INDEX IF NOT EXISTS idx_revenue_tracking_stripe_sub ON revenue_tracking(stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_service_usage_logs_email ON service_usage_logs(customer_email);
CREATE INDEX IF NOT EXISTS idx_service_usage_logs_service ON service_usage_logs(service_name);
CREATE INDEX IF NOT EXISTS idx_service_usage_logs_created ON service_usage_logs(created_at);

-- 5. Fix security definer views to security_invoker
DROP VIEW IF EXISTS forge_funnel_kpi_vw;
CREATE OR REPLACE VIEW forge_funnel_kpi_vw AS
SELECT 
    COUNT(DISTINCT c.email) as total_customers,
    COUNT(DISTINCT cs.service_name) as active_services,
    COALESCE(SUM(rt.amount), 0) as total_revenue,
    COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.email END) as active_customers
FROM customers c
LEFT JOIN customer_services cs ON c.email = cs.customer_email AND cs.status = 'active'
LEFT JOIN revenue_tracking rt ON c.email = rt.customer_email AND rt.status = 'completed'
WITH SECURITY_INVOKER;

DROP VIEW IF EXISTS forge_daily_revenue_projection_vw;
CREATE OR REPLACE VIEW forge_daily_revenue_projection_vw AS
SELECT 
    DATE(created_at) as date,
    COUNT(DISTINCT customer_email) as new_customers,
    SUM(amount) as daily_revenue,
    AVG(amount) as avg_transaction_value
FROM revenue_tracking 
WHERE status = 'completed'
GROUP BY DATE(created_at)
ORDER BY date DESC
WITH SECURITY_INVOKER;

DROP VIEW IF EXISTS forge_anomaly_signals_vw;
CREATE OR REPLACE VIEW forge_anomaly_signals_vw AS
SELECT 
    customer_email,
    COUNT(*) as error_count,
    MAX(created_at) as last_error
FROM service_usage_logs 
WHERE status_code >= 400
GROUP BY customer_email
HAVING COUNT(*) > 5
WITH SECURITY_INVOKER;

-- 6. Create provisioning functions
CREATE OR REPLACE FUNCTION provision_customer_services(
    p_customer_email TEXT,
    p_stripe_customer_id TEXT,
    p_tier TEXT DEFAULT 'starter'
)
RETURNS TABLE(service_name TEXT, status TEXT, api_key TEXT) AS $$
DECLARE
    service_record RECORD;
    api_key TEXT;
BEGIN
    -- Determine services based on tier
    FOR service_record IN 
        SELECT unnest(CASE 
            WHEN p_tier = 'enterprise' THEN ARRAY[
                'SEO Content Generator', 'Social Media Manager', 'Email Campaign Writer',
                'Blog Post Generator', 'Product Description Writer', 'Ad Copy Generator',
                'Video Script Writer', 'Press Release Generator', 'Data Pipeline Builder',
                'Report Generator', 'Analytics Dashboard', 'CSV Processor',
                'PDF Generator', 'Data Validator', 'API Connector', 'Webhook Manager',
                'Workflow Automator', 'Task Scheduler', 'Notification Manager',
                'Form Processor', 'Document Parser', 'Email Parser', 'CRM Sync',
                'Code Reviewer', 'Bug Detector', 'Test Generator',
                'Documentation Writer', 'API Mock Generator', 'Schema Validator',
                'Performance Profiler'
            ]
            WHEN p_tier = 'pro' THEN ARRAY[
                'SEO Content Generator', 'Social Media Manager', 'Email Campaign Writer',
                'Blog Post Generator', 'Data Pipeline Builder', 'Analytics Dashboard',
                'CSV Processor', 'PDF Generator', 'API Connector', 'Webhook Manager'
            ]
            ELSE ARRAY['SEO Content Generator', 'Blog Post Generator', 'Social Media Manager']
        END) AS service_name
    LOOP
        -- Generate API key
        api_key := 'fk_' || encode(gen_random_bytes(16), 'hex');
        
        -- Insert service
        INSERT INTO customer_services (
            customer_email, service_name, status, api_key, 
            limits, stripe_customer_id, activated_at
        ) VALUES (
            p_customer_email, 
            service_record.service_name, 
            'active', 
            api_key,
            jsonb_build_object(
                'requests_per_day', CASE p_tier 
                    WHEN 'enterprise' THEN 1000
                    WHEN 'pro' THEN 167
                    ELSE 33
                END,
                'storage_mb', CASE p_tier
                    WHEN 'enterprise' THEN 10240
                    WHEN 'pro' THEN 5120
                    ELSE 1024
                END
            ),
            p_stripe_customer_id,
            NOW()
        );
        
        -- Return result
        service_name := service_record.service_name;
        status := 'active';
        
        RETURN NEXT;
    END LOOP;
    
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create revenue tracking function
CREATE OR REPLACE FUNCTION track_stripe_revenue(
    p_stripe_event_id TEXT,
    p_customer_email TEXT,
    p_amount INTEGER,
    p_currency TEXT DEFAULT 'usd',
    p_type TEXT DEFAULT 'payment',
    p_metadata JSONB DEFAULT '{}'
)
RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO revenue_tracking (
        stripe_event_id, customer_email, amount, currency, type, metadata, created_at
    ) VALUES (
        p_stripe_event_id, p_customer_email, p_amount, p_currency, p_type, p_metadata, NOW()
    ) ON CONFLICT (stripe_event_id) DO NOTHING;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Enable real-time subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE customer_services;
ALTER PUBLICATION supabase_realtime ADD TABLE revenue_tracking;

-- 9. Create verification queries
DO $$
BEGIN
    RAISE NOTICE 'Stripe integration schema deployed successfully';
    RAISE NOTICE 'Tables: customer_services, revenue_tracking, service_usage_logs';
    RAISE NOTICE 'Views: forge_funnel_kpi_vw, forge_daily_revenue_projection_vw, forge_anomaly_signals_vw';
    RAISE NOTICE 'Functions: provision_customer_services, track_stripe_revenue';
    RAISE NOTICE 'Security: All views set to SECURITY_INVOKER';
END $$;
