// Test critical path after key rotation
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log('🧪 TESTING CRITICAL PATH');
console.log('=======================');

async function testCriticalPath() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  console.log('\n1️⃣ Testing Database Access...');
  try {
    const { data, error } = await supabase
      .from('keeper_circuit_state')
      .select('level, reason')
      .limit(1);
    
    if (error) {
      console.log(`❌ Database access failed: ${error.message}`);
      return false;
    } else {
      console.log('✅ Database access: WORKING');
    }
  } catch (e) {
    console.log(`❌ Database test crashed: ${e.message}`);
    return false;
  }
  
  console.log('\n2️⃣ Testing Monetization Tables...');
  try {
    const { data: ledger, error: ledgerError } = await supabase
      .from('ledger')
      .select('transaction_id, amount_gross')
      .limit(1);
    
    if (ledgerError) {
      console.log(`❌ Ledger access failed: ${ledgerError.message}`);
      return false;
    } else {
      console.log('✅ Ledger access: WORKING');
    }
    
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('client_name, email')
      .limit(1);
    
    if (clientsError) {
      console.log(`❌ Clients access failed: ${clientsError.message}`);
      return false;
    } else {
      console.log('✅ Clients access: WORKING');
    }
  } catch (e) {
    console.log(`❌ Monetization test crashed: ${e.message}`);
    return false;
  }
  
  console.log('\n3️⃣ Testing Security Functions...');
  try {
    const { data: anchor, error: anchorError } = await supabase
      .rpc('keeper_compute_anchor');
    
    if (anchorError) {
      console.log(`❌ Anchor function failed: ${anchorError.message}`);
      return false;
    } else {
      console.log('✅ Anchor function: WORKING');
    }
    
    const { data: escalate, error: escalateError } = await supabase
      .rpc('keeper_auto_escalate');
    
    if (escalateError) {
      console.log(`❌ Auto-escalate function failed: ${escalateError.message}`);
      return false;
    } else {
      console.log('✅ Auto-escalate function: WORKING');
    }
  } catch (e) {
    console.log(`❌ Security functions test crashed: ${e.message}`);
    return false;
  }
  
  console.log('\n4️⃣ Checking Break Glass Token...');
  if (!process.env.KEEPER_BREAK_GLASS_TOKEN) {
    console.log('❌ Break glass token: MISSING');
    return false;
  } else {
    console.log('✅ Break glass token: PRESENT');
  }
  
  console.log('\n🎯 CRITICAL PATH STATUS: ALL SYSTEMS OPERATIONAL');
  return true;
}

testCriticalPath().then(success => {
  if (success) {
    console.log('\n✅ SAFE TO PROCEED WITH DEPLOYMENTS');
  } else {
    console.log('\n❌ FIX ISSUES BEFORE DEPLOYING');
  }
});
