// Generate new secure token - COMPROMISED TOKEN MUST BE RETIRED
const crypto = require('crypto');

const newToken = crypto.randomBytes(32).toString('hex');
console.log('🔐 NEW SECURE TOKEN (REPLACE COMPROMISED ONE):');
console.log('============================================');
console.log(newToken);
console.log('');
console.log('⚠️  IMMEDIATE ACTIONS REQUIRED:');
console.log('1. Update Vercel: vercel env rm KEEPER_BREAK_GLASS_TOKEN production');
console.log('2. Update Vercel: vercel env add KEEPER_BREAK_GLASS_TOKEN production');
console.log('3. Update Supabase: supabase secrets set KEEPER_BREAK_GLASS_TOKEN');
console.log('4. Update .env file');
console.log('5. Redeploy: vercel --prod');
console.log('');
console.log('❌ OLD TOKEN IS COMPROMISED - NEVER REUSE');
