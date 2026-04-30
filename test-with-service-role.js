// Test with service role key in headers
const { createClient } = require('@supabase/supabase-js');

async function testWithServiceRole() {
  console.log('🔑 TESTING WITH SERVICE ROLE KEY');
  console.log('===============================');
  
  const edgeFunctionUrl = 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/keeper-break-glass-simple';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const breakGlassToken = 'break-glass-secret-test';
  
  if (!serviceRoleKey) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
    return;
  }
  
  try {
    console.log('\n📋 Testing with service role key in headers...');
    
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`, // Use service role key
        'x-break-glass-token': breakGlassToken, // Custom header for our token
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        level: 4,
        ttl_minutes: 30,
        reason: 'Service role key authentication test',
        requested_by: 'service_role_validation'
      })
    });
    
    const result = await response.json();
    
    console.log(`Status: ${response.status}`);
    console.log('Response:', JSON.stringify(result, null, 2));
    
    if (response.status === 200 && result.success) {
      console.log('✅ SUCCESS WITH SERVICE ROLE KEY!');
      console.log(`   Level: ${result.circuit_state.level}`);
      console.log(`   Expires: ${result.circuit_state.expires_at}`);
      console.log(`   Reason: ${result.circuit_state.reason}`);
      
      // Verify in database
      const supabase = createClient(
        'https://akbnfovjdcobifeupvbn.supabase.co',
        serviceRoleKey
      );
      
      const { data: circuitState } = await supabase
        .from('keeper_circuit_state')
        .select('*')
        .eq('id', 1)
        .single();
      
      console.log('\n📋 Database Verification:');
      console.log(`   Level: ${circuitState.level}`);
      console.log(`   Set by: ${circuitState.set_by}`);
      console.log(`   Reason: ${circuitState.reason}`);
      
    } else {
      console.log('❌ Service role key test failed');
      console.log(`   Error: ${result.message}`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testWithServiceRole();
