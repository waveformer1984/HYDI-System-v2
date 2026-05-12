require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Simple read test to diagnose the issue
async function simpleReadTest() {
  console.log('=== SIMPLE READ TEST ===\n');
  
  try {
    console.log('Creating Supabase client...');
    console.log('URL:', process.env.SUPABASE_URL);
    console.log('Key exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    console.log('Client created successfully');
    
    // Test basic connection
    console.log('Testing basic connection...');
    const { data, error } = await supabase
      .from('hydi_events')
      .select('count')
      .limit(1);
    
    if (error) {
      console.log('Query error:', error);
      console.log('Error details:', JSON.stringify(error, null, 2));
    } else {
      console.log('Query successful:', data);
    }
    
  } catch (err) {
    console.log('Exception caught:', err.message);
    console.log('Stack:', err.stack);
  }
}

simpleReadTest();
