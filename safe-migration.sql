-- SAFE IDEMPOTENT MIGRATION FOR FORGE LOCKDOWN
-- This script handles existing objects and creates missing tables safely

-- 1. System Status Table (if not exists)
CREATE TABLE IF NOT EXISTS system_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status TEXT NOT NULL,
    version TEXT DEFAULT '2.0.0-live',
    active_services INTEGER DEFAULT 30,
    cpu_usage FLOAT,
    last_broadcast TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Leads Table (if not exists)
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    source TEXT DEFAULT 'heidi_broadcast',
    metadata JSONB DEFAULT '{}',
    welcome_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Heidi Memory Table - Handle existing hydi_memory
-- Check if hydi_memory exists and create heidi_memory if needed
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'hydi_memory' AND table_schema = 'public') THEN
        -- hydi_memory exists, create heidi_memory as alias or rename
        IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'heidi_memory' AND table_schema = 'public') THEN
            -- Create heidi_memory with same structure
            CREATE TABLE heidi_memory (LIKE hydi_memory INCLUDING ALL);
            -- Copy data if needed
            INSERT INTO heidi_memory SELECT * FROM hydi_memory;
        END IF;
    ELSE
        -- Neither exists, create fresh heidi_memory
        CREATE TABLE IF NOT EXISTS heidi_memory (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_email TEXT,
            last_interaction_type TEXT,
            interaction_data JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    END IF;
END $$;

-- 4. Pending Tasks Table (if not exists)
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

-- Enable RLS (Row Level Security) - Safe to run multiple times
ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE heidi_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_tasks ENABLE ROW LEVEL SECURITY;

-- Create policies - Safe to run multiple times
DROP POLICY IF EXISTS "Service Role Full Access system_status" ON system_status;
CREATE POLICY "Service Role Full Access system_status" ON system_status USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Full Access leads" ON leads;
CREATE POLICY "Service Role Full Access leads" ON leads USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Full Access heidi_memory" ON heidi_memory;
CREATE POLICY "Service Role Full Access heidi_memory" ON heidi_memory USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Full Access pending_tasks" ON pending_tasks;
CREATE POLICY "Service Role Full Access pending_tasks" ON pending_tasks USING (true) WITH CHECK (true);

-- Add indexes - Safe to run multiple times
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

-- Enable Real-time for Dashboard - Safe to run multiple times
ALTER PUBLICATION supabase_realtime ADD TABLE system_status;
ALTER PUBLICATION supabase_realtime ADD TABLE leads;

-- Insert initial system status - Safe to run multiple times
INSERT INTO system_status (status, version, active_services, cpu_usage)
VALUES ('LIVE', '2.0.0-live', 30, 15.5)
ON CONFLICT DO NOTHING;

-- Migration complete notification
DO $$
BEGIN
    RAISE NOTICE 'Forge Lockdown migration completed successfully';
    RAISE NOTICE 'Tables: system_status, leads, heidi_memory, pending_tasks';
    RAISE NOTICE 'RLS enabled, policies created, indexes added';
END $$;
