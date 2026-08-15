// Generate new secure token - COMPROMISED TOKEN MUST BE RETIRED
// Security rule: generated secret values are NEVER logged.
const crypto = require('crypto');

function generateNewToken() {
  const newToken = process.env.GENERATE_TOKEN_TEST_SECRET
    ? process.env.GENERATE_TOKEN_TEST_SECRET
    : crypto.randomBytes(32).toString('hex');

  // Intentionally do not log the token value. The output only contains
  // non-sensitive metadata and the manual steps required for deployment.
  console.log('🔐 NEW SECURE TOKEN GENERATED (value intentionally not logged)');
  console.log('==============================================================');
  console.log(`TOKEN ID: KEEPER_BREAK_GLASS_TOKEN`);
  console.log(`TIMESTAMP: ${new Date().toISOString()}`);
  console.log('');
  console.log('⚠️  IMMEDIATE ACTIONS REQUIRED:');
  console.log('1. Update Vercel: vercel env rm KEEPER_BREAK_GLASS_TOKEN production');
  console.log('2. Update Vercel: vercel env add KEEPER_BREAK_GLASS_TOKEN production');
  console.log('3. Update Supabase: supabase secrets set KEEPER_BREAK_GLASS_TOKEN');
  console.log('4. Update .env file');
  console.log('5. Redeploy: vercel --prod');
  console.log('');
  console.log('❌ OLD TOKEN IS COMPROMISED - NEVER REUSE');

  return {
    token: newToken,
    identifier: 'KEEPER_BREAK_GLASS_TOKEN',
    status: 'generated',
    timestamp: new Date().toISOString(),
  };
}

if (require.main === module) {
  generateNewToken();
}

module.exports = { generateNewToken };
