const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function setupSupabase() {
  console.log('Setting up Supabase tables...');
  
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Read and execute SQL file
  const fs = require('fs');
  const path = require('path');
  const sqlFile = path.join(__dirname, 'create-supabase-tables.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');
  
  try {
    // Split SQL into individual statements and execute
    const statements = sql.split(';').filter(s => s.trim().length > 0);
    
    for (const statement of statements) {
      if (statement.trim()) {
        console.log('Executing:', statement.substring(0, 100) + '...');
        
        // Use raw SQL execution
        const { error } = await supabase.rpc('exec_sql', { sql_query: statement });
        
        if (error) {
          console.warn('Warning:', error.message);
        }
      }
    }
    
    console.log('Setup complete!');
    
    // Test the tables
    console.log('Testing system_status table...');
    const { data: statusData, error: statusError } = await supabase
      .from('system_status')
      .select('*')
      .limit(1);
    
    if (statusError) {
      console.error('System status test failed:', statusError.message);
    } else {
      console.log('System status table working:', statusData);
    }
    
    console.log('Testing leads table...');
    const { data: leadsData, error: leadsError } = await supabase
      .from('leads')
      .select('*')
      .limit(1);
    
    if (leadsError) {
      console.error('Leads test failed:', leadsError.message);
    } else {
      console.log('Leads table working:', leadsData);
    }
    
  } catch (error) {
    console.error('Setup failed:', error.message);
    process.exit(1);
  }
}

setupSupabase();
