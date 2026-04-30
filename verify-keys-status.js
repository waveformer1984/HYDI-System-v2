// Verify current key status and identify what needs updating
require('dotenv').config();

console.log('🔍 VERIFYING KEY STATUS');
console.log('=====================');

// Check Supabase keys
console.log('\n📋 SUPABASE KEYS:');
console.log(`✓ ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? 'PRESENT' : 'MISSING'}`);
console.log(`✓ SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'PRESENT' : 'MISSING'}`);

// Check Stripe keys
console.log('\n📋 STRIPE KEYS:');
console.log(`✓ SECRET_KEY: ${process.env.STRIPE_SECRET_KEY ? 'PRESENT' : 'MISSING'}`);
console.log(`✓ WEBHOOK_SECRET_01: ${process.env.STRIPE_WEBHOOK_SECRET_01 ? 'PRESENT' : 'MISSING'}`);

// Check other critical keys
console.log('\n📋 OTHER KEYS:');
console.log(`✓ KEEPER_BREAK_GLASS_TOKEN: ${process.env.KEEPER_BREAK_GLASS_TOKEN ? 'PRESENT' : 'MISSING'}`);

// Test Supabase connectivity with current keys
const { createClient } = require('@supabase/supabase-js');

async function testSupabaseKeys() {
  console.log('\n🧪 TESTING SUPABASE CONNECTIVITY:');
  
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Test with anon key
    const supabaseAnon = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    
    console.log('Testing service_role key...');
    const { data: serviceData, error: serviceError } = await supabase
      .from('keeper_circuit_state')
      .select('level')
      .limit(1);
    
    if (serviceError) {
      console.log(`❌ Service role key: ${serviceError.message}`);
    } else {
      console.log('✅ Service role key: WORKING');
    }
    
    console.log('Testing anon key...');
    const { data: anonData, error: anonError } = await supabaseAnon
      .from('public.clients')
      .select('client_name')
      .limit(1);
    
    if (anonError) {
      console.log(`❌ Anon key: ${anonError.message}`);
    } else {
      console.log('✅ Anon key: WORKING');
    }
    
  } catch (error) {
    console.log(`❌ Supabase test failed: ${error.message}`);
  }
}

testSupabaseKeys();

console.log('\n📋 NEXT STEPS:');
console.log('1. If any keys show MISSING, update .env');
console.log('2. If any tests show ERROR, rotate that key');
console.log('3. Update Supabase Edge Function secrets');
console.log('4. Update Stripe webhook endpoints');
