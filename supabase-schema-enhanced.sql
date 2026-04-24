-- Final Schema for Ursula & Heidi Integration
-- This ensures the Agent Bus has a place to store its telemetry and leads

-- 1. System Health & Performance Tracking
CREATE TABLE IF NOT EXISTS system_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status TEXT NOT NULL, -- e.g., 'LIVE', 'MAINTENANCE'
    version TEXT DEFAULT '2.0.0-live',
    active_services INTEGER DEFAULT 30,
    cpu_usage FLOAT,
    memory_usage FLOAT,
    last_broadcast TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Lead Generation & Customer Lifecycle
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    source TEXT DEFAULT 'heidi_broadcast',
    tier TEXT DEFAULT 'starter',
    metadata JSONB, -- For storing specific service interests
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Heidi's Engagement Memory
CREATE TABLE IF NOT EXISTS heidi_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id),
    last_interaction_type TEXT,
    last_pitch_date TIMESTAMPTZ,
    outreach_count INTEGER DEFAULT 0
);

-- 4. Enable Real-time for Dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE system_status;

-- Enable RLS (Row Level Security)
ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE heidi_memory ENABLE ROW LEVEL SECURITY;

-- Create policies to allow service_role to manage all
CREATE POLICY "Service Role Full Access" ON system_status USING (true) WITH CHECK (true);
CREATE POLICY "Service Role Full Access" ON leads USING (true) WITH CHECK (true);
CREATE POLICY "Service Role Full Access" ON heidi_memory USING (true) WITH CHECK (true);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_system_status_status ON system_status(status);
CREATE INDEX IF NOT EXISTS idx_system_status_broadcast ON system_status(last_broadcast);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_heidi_memory_user ON heidi_memory(user_id);

-- Insert initial system status
INSERT INTO system_status (status, version, active_services, cpu_usage, memory_usage)
VALUES ('LIVE', '2.0.0-live', 30, 15.5, 42.3)
ON CONFLICT DO NOTHING;
