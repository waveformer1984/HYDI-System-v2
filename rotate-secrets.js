// CRITICAL: Rotate exposed secrets immediately
// Security rule: generated secret values are NEVER logged.
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

async function rotateSecrets() {
  console.log('🚨 CRITICAL: ROTATING EXPOSED SECRETS');
  console.log('=====================================');
  console.log('⚠️  REAL TOKENS/KEYS WERE SHARED IN LOGS');
  console.log('');

  const supabaseUrl = process.env.SUPABASE_URL || 'https://akbnfovjdcobifeupvbn.supabase.co';
  const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Generate new secure tokens.  In a test run, deterministic values may be
  // injected so the output can be audited without ever leaking real material.
  const newBreakGlassToken = process.env.ROTATION_TEST_BREAK_GLASS_TOKEN
    ? process.env.ROTATION_TEST_BREAK_GLASS_TOKEN
    : crypto.randomBytes(32).toString('hex');
  const newServiceRoleKey = process.env.ROTATION_TEST_SERVICE_ROLE_KEY
    ? process.env.ROTATION_TEST_SERVICE_ROLE_KEY
    : crypto.randomBytes(32).toString('hex');

  // Intentionally omit the values.  Metadata is safe to log.
  console.log('🔐 NEW SECRETS GENERATED (values intentionally not logged):');
  console.log('========================');
  console.log(`BREAK-GLASS TOKEN ID: KEEPER_BREAK_GLASS_TOKEN`);
  console.log(`SERVICE ROLE ID: SUPABASE_SERVICE_ROLE_KEY`);
  console.log(`ROTATION TIMESTAMP: ${new Date().toISOString()}`);
  console.log('');

  // Update Supabase secrets
  console.log('📋 Updating Supabase secrets...');

  try {
    console.log('MANUAL STEPS REQUIRED:');
    console.log('1. Go to Supabase Dashboard → Settings → API');
    console.log('2. Regenerate service_role key');
    console.log('3. Go to Supabase Dashboard → Edge Functions → Secrets');
    console.log('4. Update KEEPER_BREAK_GLASS_TOKEN');
    console.log('5. Update .env file with new values');
    console.log('');
    console.log('⚠️  ALL EXISTING TOKENS ARE NOW COMPROMISED');
    console.log('   Rotate them immediately in production!');

    // Return the values to the caller so that well-behaved callers can pass
    // them to a vault without ever writing them to a log.
    return {
      breakGlassToken: newBreakGlassToken,
      serviceRoleKey: newServiceRoleKey,
      identifiers: ['KEEPER_BREAK_GLASS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY'],
      status: 'generated',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('❌ Secret rotation failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  rotateSecrets().catch((error) => {
    console.error('Rotation failed:', error.message);
    process.exit(1);
  });
}

module.exports = { rotateSecrets };
