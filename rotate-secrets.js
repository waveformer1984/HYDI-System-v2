// CRITICAL: Rotate exposed secrets immediately
const { createClient } = require('@supabase/supabase-js');

async function rotateSecrets() {
  console.log('🚨 CRITICAL: ROTATING EXPOSED SECRETS');
  console.log('=====================================');
  console.log('⚠️  REAL TOKENS/KEYS WERE SHARED IN LOGS');
  console.log('');
  
  const supabase = createClient(
    'https://akbnfovjdcobifeupvbn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  // Generate new secure tokens
  const crypto = require('crypto');
  
  const newBreakGlassToken = crypto.randomBytes(32).toString('hex');
  const newServiceRoleKey = crypto.randomBytes(32).toString('hex');
  
  console.log('🔐 NEW SECRETS GENERATED:');
  console.log('========================');
  console.log(`NEW BREAK-GLASS TOKEN: ${newBreakGlassToken}`);
  console.log(`NEW SERVICE ROLE KEY: ${newServiceRoleKey}`);
  console.log('');
  
  // Update Supabase secrets
  console.log('📋 Updating Supabase secrets...');
  
  try {
    // Note: These would need to be run manually in Supabase dashboard
    console.log('MANUAL STEPS REQUIRED:');
    console.log('1. Go to Supabase Dashboard → Settings → API');
    console.log('2. Regenerate service_role key');
    console.log('3. Go to Supabase Dashboard → Edge Functions → Secrets');
    console.log('4. Update KEEPER_BREAK_GLASS_TOKEN');
    console.log('5. Update .env file with new values');
    console.log('');
    console.log('⚠️  ALL EXISTING TOKENS ARE NOW COMPROMISED');
    console.log('   Rotate them immediately in production!');
    
  } catch (error) {
    console.error('❌ Secret rotation failed:', error.message);
  }
}

rotateSecrets();
