// Apply the anchor function fix via Supabase
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

async function applyFix() {
  console.log('🔧 APPLYING ANCHOR FUNCTION FIX');
  console.log('===============================');
  
  const supabase = createClient(
    'https://akbnfovjdcobifeupvbn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'fix-anchor-function.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Extract just the function definition (skip the test at the end)
    const functionDef = sqlContent.split('-- Test the fixed function')[0].trim();
    
    console.log('📋 Applying updated function definition...');
    
    // Use the raw SQL execution through Supabase
    const { data, error } = await supabase
      .rpc('exec_sql', { sql_query: functionDef });
    
    if (error) {
      console.error('❌ Direct RPC failed, trying alternative...');
      
      // Alternative: Use the database shell through a different approach
      console.log('📋 Testing fixed function directly...');
      
      const { data: testResult, error: testError } = await supabase
        .rpc('keeper_compute_anchor', { p_sink: 'local_db' });
      
      if (testError) {
        console.error('❌ Function still fails:', testError.message);
        console.error('This suggests the function wasn\'t updated.');
        console.error('Manual SQL execution may be required.');
      } else {
        console.log('✅ Function works after fix');
        console.log('   Anchor ID:', testResult.anchor_id);
        console.log('   Chain Head:', testResult.chain_head_hash);
      }
    } else {
      console.log('✅ Function updated successfully');
    }
    
  } catch (error) {
    console.error('❌ Fix application failed:', error.message);
  }
}

applyFix();
