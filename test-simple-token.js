// Test with simple token instead of JWT
const { createClient } = require('@supabase/supabase-js');

async function testSimpleToken() {
  console.log('🔑 TESTING SIMPLE TOKEN AUTH');
  console.log('============================');
  
  // Read the actual token from .env
  const fs = require('fs');
  const envContent = fs.readFileSync('.env', 'utf8');
  const breakGlassTokenMatch = envContent.match(/KEEPER_BREAK_GLASS_TOKEN=(.+)/);
  
  if (!breakGlassTokenMatch) {
    console.error('❌ KEEPER_BREAK_GLASS_TOKEN not found in .env');
    return;
  }
  
  const breakGlassToken = breakGlassTokenMatch[1].trim();
  console.log('✅ Found break-glass token');
  console.log(`Token: ${breakGlassToken.substring(0, 20)}...`);
  
  const edgeFunctionUrl = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/keeper-break-glass';
  
  try {
    // Test with simple token
    console.log('\n📋 Testing simple token authentication...');
    
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${breakGlassToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        level: 3,
        ttl_minutes: 20,
        reason: 'Simple token break-glass override test',
        requested_by: 'simple_token_validation'
      })
    });
    
    const result = await response.json();
    
    console.log(`Status: ${response.status}`);
    console.log('Response:', JSON.stringify(result, null, 2));
    
    if (response.status === 200 && result.success) {
      console.log('✅ Simple token authentication successful');
      console.log(`   Override applied: Level ${result.circuit_state.level}`);
      console.log(`   Expires: ${result.circuit_state.expires_at}`);
      console.log(`   Audit ID: ${result.audit_id}`);
      
      // Verify in database
      const supabase = createClient(
        'https://akbnfovjdcobifeupvbn.supabase.co',
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      const { data: circuitState } = await supabase
        .from('keeper_circuit_state')
        .select('*')
        .eq('id', 1)
        .single();
      
      console.log('\n📋 Database verification:');
      console.log(`   Level: ${circuitState.level}`);
      console.log(`   Set by: ${circuitState.set_by}`);
      console.log(`   Reason: ${circuitState.reason}`);
      
    } else {
      console.log('❌ Simple token authentication failed');
      if (result.debug) {
        console.log(`   Debug: ${result.debug}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testSimpleToken();
