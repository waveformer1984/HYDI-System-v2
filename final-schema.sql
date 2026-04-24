-- Create System Status Table
CREATE TABLE IF NOT EXISTS system_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status TEXT NOT NULL,
    version TEXT DEFAULT '2.0.0-live',
    active_services INTEGER DEFAULT 30,
    cpu_usage FLOAT,
    last_broadcast TIMESTAMPTZ DEFAULT NOW()
);

-- Create Leads Table
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    source TEXT DEFAULT 'heidi_broadcast',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Heidi Memory Table
CREATE TABLE IF NOT EXISTS heidi_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_email TEXT,
    last_interaction_type TEXT,
    interaction_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_heidi_memory_email ON heidi_memory(user_email);
