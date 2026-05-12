require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function checkTables() {
  console.log('=== CHECKING SUPABASE TABLES ===\n');
  
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  // Try hydi_events first
  try {
    console.log('Checking hydi_events table...');
    const { data, error } = await supabase
      .from('hydi_events')
      .select('count')
      .limit(1);
    
    if (error) {
      console.log('hydi_events error:', error.message);
    } else {
      console.log('hydi_events: EXISTS');
    }
  } catch (err) {
    console.log('hydi_events failed:', err.message);
  }
  
  // Try events
  try {
    console.log('Checking events table...');
    const { data, error } = await supabase
      .from('events')
      .select('count')
      .limit(1);
    
    if (error) {
      console.log('events error:', error.message);
    } else {
      console.log('events: EXISTS');
    }
  } catch (err) {
    console.log('events failed:', err.message);
  }
  
  // Test connection
  try {
    console.log('\nTesting basic connection...');
    const { data, error } = await supabase
      .rpc('version');
    
    if (error) {
      console.log('Connection test error:', error.message);
    } else {
      console.log('Connection: OK');
    }
  } catch (err) {
    console.log('Connection failed:', err.message);
  }
}

checkTables();
