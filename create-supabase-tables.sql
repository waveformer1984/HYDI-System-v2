-- Create system_status table
CREATE TABLE IF NOT EXISTS system_status (
  id TEXT PRIMARY KEY DEFAULT 'current',
  status TEXT NOT NULL DEFAULT 'offline',
  services_count INTEGER DEFAULT 0,
  services_list JSONB DEFAULT '[]',
  broadcasted_at TIMESTAMPTZ DEFAULT NOW(),
  version TEXT DEFAULT '1.0.0',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create leads table
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  name TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_system_status_status ON system_status(status);

-- Enable Row Level Security (RLS)
ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Create policies for system_status
CREATE POLICY "Allow all operations on system_status" ON system_status
  FOR ALL USING (true);

-- Create policies for leads
CREATE POLICY "Allow all operations on leads" ON leads
  FOR ALL USING (true);

-- Insert initial system status
INSERT INTO system_status (id, status, services_count, services_list, version)
VALUES ('current', 'live', 30, 
  '["SEO Content Generator", "Social Media Manager", "Email Campaign Writer", "Blog Post Generator", "Product Description Writer", "Ad Copy Generator", "Video Script Writer", "Press Release Generator", "Data Pipeline Builder", "Report Generator", "Analytics Dashboard", "CSV Processor", "PDF Generator", "Data Validator", "API Connector", "Webhook Manager", "Workflow Automator", "Task Scheduler", "Notification Manager", "Form Processor", "Document Parser", "Email Parser", "CRM Sync", "Code Reviewer", "Bug Detector", "Test Generator", "Documentation Writer", "API Mock Generator", "Schema Validator", "Performance Profiler"]',
  '2.0.0-live')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  services_count = EXCLUDED.services_count,
  services_list = EXCLUDED.services_list,
  broadcasted_at = EXCLUDED.broadcasted_at,
  version = EXCLUDED.version,
  updated_at = NOW();
