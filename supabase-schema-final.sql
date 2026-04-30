-- Create System Status Table for Heidi's Reports
CREATE TABLE IF NOT EXISTS system_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status TEXT NOT NULL,
    version TEXT,
    active_services INTEGER,
    last_broadcast TIMESTAMPTZ DEFAULT NOW()
);

-- Create Leads Table for Heidi's Outreach
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    source TEXT,
    tier TEXT DEFAULT 'starter',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (Row Level Security)
ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service_role to manage all
CREATE POLICY "Service Role Full Access" ON system_status USING (true) WITH CHECK (true);
CREATE POLICY "Service Role Full Access" ON leads USING (true) WITH CHECK (true);
