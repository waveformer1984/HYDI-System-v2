-- Stripe Integration Schema
-- Adds tables for customer management and service provisioning

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT UNIQUE,
    tier TEXT DEFAULT 'starter',
    status TEXT DEFAULT 'active', -- active, deactivated, suspended
    limits JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer Services table
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
    
    FOREIGN KEY (customer_email) REFERENCES customers(email) ON DELETE CASCADE
);

-- Revenue Tracking table
CREATE TABLE IF NOT EXISTS revenue_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stripe_event_id TEXT UNIQUE,
    customer_email TEXT,
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'usd',
    type TEXT, -- payment, refund, subscription
    status TEXT DEFAULT 'completed',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Service Usage Logs table
CREATE TABLE IF NOT EXISTS service_usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_email TEXT NOT NULL,
    service_name TEXT NOT NULL,
    endpoint TEXT,
    request_count INTEGER DEFAULT 1,
    response_time INTEGER, -- in milliseconds
    status_code INTEGER,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_usage_logs ENABLE ROW LEVEL SECURITY;

-- Create policies
DROP POLICY IF EXISTS "Service Role Full Access customers" ON customers;
CREATE POLICY "Service Role Full Access customers" ON customers USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Full Access customer_services" ON customer_services;
CREATE POLICY "Service Role Full Access customer_services" ON customer_services USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Full Access revenue_tracking" ON revenue_tracking;
CREATE POLICY "Service Role Full Access revenue_tracking" ON revenue_tracking USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Full Access service_usage_logs" ON service_usage_logs;
CREATE POLICY "Service Role Full Access service_usage_logs" ON service_usage_logs USING (true) WITH CHECK (true);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_stripe_id ON customers(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_tier ON customers(tier);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

CREATE INDEX IF NOT EXISTS idx_customer_services_email ON customer_services(customer_email);
CREATE INDEX IF NOT EXISTS idx_customer_services_service ON customer_services(service_name);
CREATE INDEX IF NOT EXISTS idx_customer_services_status ON customer_services(status);

CREATE INDEX IF NOT EXISTS idx_revenue_tracking_email ON revenue_tracking(customer_email);
CREATE INDEX IF NOT EXISTS idx_revenue_tracking_created ON revenue_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_revenue_tracking_type ON revenue_tracking(type);

CREATE INDEX IF NOT EXISTS idx_service_usage_logs_email ON service_usage_logs(customer_email);
CREATE INDEX IF NOT EXISTS idx_service_usage_logs_service ON service_usage_logs(service_name);
CREATE INDEX IF NOT EXISTS idx_service_usage_logs_created ON service_usage_logs(created_at);

-- Enable Real-time
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
ALTER PUBLICATION supabase_realtime ADD TABLE customer_services;

-- Function to update customer tier
CREATE OR REPLACE FUNCTION update_customer_tier()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for automatic timestamp updates
CREATE TRIGGER update_customers_timestamp
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_customer_tier();

CREATE TRIGGER update_customer_services_timestamp
    BEFORE UPDATE ON customer_services
    FOR EACH ROW
    EXECUTE FUNCTION update_customer_tier();

-- Migration complete
DO $$
BEGIN
    RAISE NOTICE 'Stripe Integration schema created successfully';
    RAISE NOTICE 'Tables: customers, customer_services, revenue_tracking, service_usage_logs';
END $$;
