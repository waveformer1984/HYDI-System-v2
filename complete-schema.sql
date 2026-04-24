-- Complete Schema for Forge Lockdown Implementation
-- Includes all tables for persistent revenue engine

-- 1. System Status Table
CREATE TABLE IF NOT EXISTS system_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status TEXT NOT NULL,
    version TEXT DEFAULT '2.0.0-live',
    active_services INTEGER DEFAULT 30,
    cpu_usage FLOAT,
    last_broadcast TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Leads Table
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    source TEXT DEFAULT 'heidi_broadcast',
    metadata JSONB DEFAULT '{}',
    welcome_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Heidi Memory Table
CREATE TABLE IF NOT EXISTS heidi_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_email TEXT,
    last_interaction_type TEXT,
    interaction_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Pending Tasks Table (for Message Recovery)
CREATE TABLE IF NOT EXISTS pending_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id TEXT UNIQUE NOT NULL,
    origin TEXT NOT NULL,
    target TEXT NOT NULL,
    action TEXT NOT NULL,
    payload JSONB,
    priority TEXT DEFAULT 'SYSTEM',
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    recovered_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (Row Level Security)
ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE heidi_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_tasks ENABLE ROW LEVEL SECURITY;

-- Create policies to allow service_role to manage all
CREATE POLICY "Service Role Full Access" ON system_status USING (true) WITH CHECK (true);
CREATE POLICY "Service Role Full Access" ON leads USING (true) WITH CHECK (true);
CREATE POLICY "Service Role Full Access" ON heidi_memory USING (true) WITH CHECK (true);
CREATE POLICY "Service Role Full Access" ON pending_tasks USING (true) WITH CHECK (true);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_system_status_status ON system_status(status);
CREATE INDEX IF NOT EXISTS idx_system_status_broadcast ON system_status(last_broadcast);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_welcome ON leads(welcome_sent);
CREATE INDEX IF NOT EXISTS idx_heidi_memory_email ON heidi_memory(user_email);
CREATE INDEX IF NOT EXISTS idx_heidi_memory_type ON heidi_memory(last_interaction_type);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_status ON pending_tasks(status);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_created ON pending_tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_message ON pending_tasks(message_id);

-- Enable Real-time for Dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE system_status;
ALTER PUBLICATION supabase_realtime ADD TABLE leads;

-- Insert initial system status
INSERT INTO system_status (status, version, active_services, cpu_usage)
VALUES ('LIVE', '2.0.0-live', 30, 15.5)
ON CONFLICT DO NOTHING;
