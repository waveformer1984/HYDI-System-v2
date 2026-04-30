const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function setupSupabase() {
  console.log('Setting up Supabase tables using direct API...');
  
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  try {
    // Try to insert into system_status table to see if it exists
    const { data: statusData, error: statusError } = await supabase
      .from('system_status')
      .upsert({
        id: 'current',
        status: 'live',
        services_count: 30,
        services_list: [
          "SEO Content Generator", "Social Media Manager", "Email Campaign Writer",
          "Blog Post Generator", "Product Description Writer", "Ad Copy Generator",
          "Video Script Writer", "Press Release Generator", "Data Pipeline Builder",
          "Report Generator", "Analytics Dashboard", "CSV Processor", "PDF Generator",
          "Data Validator", "API Connector", "Webhook Manager", "Workflow Automator",
          "Task Scheduler", "Notification Manager", "Form Processor", "Document Parser",
          "Email Parser", "CRM Sync", "Code Reviewer", "Bug Detector", "Test Generator",
          "Documentation Writer", "API Mock Generator", "Schema Validator", "Performance Profiler"
        ],
        version: '2.0.0-live'
      })
      .select();
    
    if (statusError) {
      console.log('System status table does not exist or permission denied:', statusError.message);
      
      // Try to create the table using SQL via the REST API directly
      console.log('Attempting to create tables via direct SQL...');
      
      // We'll need to use the Supabase SQL editor or CLI for table creation
      // For now, let's create a simple workaround using the existing schema
      
    } else {
      console.log('System status table exists and data inserted:', statusData);
    }
    
    // Try to insert into leads table
    const { data: leadsData, error: leadsError } = await supabase
      .from('leads')
      .upsert({
        email: 'test@example.com',
        name: 'Test Lead',
        status: 'active'
      })
      .select();
    
    if (leadsError) {
      console.log('Leads table does not exist or permission denied:', leadsError.message);
    } else {
      console.log('Leads table exists and data inserted:', leadsData);
    }
    
    // If tables don't exist, provide instructions
    if (statusError && statusError.message.includes('does not exist')) {
      console.log('\n=== MANUAL SETUP REQUIRED ===');
      console.log('Please run these SQL commands in your Supabase SQL editor:');
      console.log('https://supabase.com/dashboard/project/wufhlhrbskacneneylqa/sql');
      console.log('\nSQL to run:');
      console.log(`
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

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  name TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE system_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on system_status" ON system_status FOR ALL USING (true);
CREATE POLICY "Allow all operations on leads" ON leads FOR ALL USING (true);
      `);
    }
    
  } catch (error) {
    console.error('Setup failed:', error.message);
  }
}

setupSupabase();
