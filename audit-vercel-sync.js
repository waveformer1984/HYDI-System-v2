// Audit Vercel vs Local environment synchronization
require('dotenv').config();

console.log('🔍 AUDITING VERCEL vs LOCAL ENVIRONMENT SYNC');
console.log('===========================================');

// Local environment keys
const localKeys = {
  'SUPABASE_URL': process.env.SUPABASE_URL,
  'SUPABASE_ANON_KEY': process.env.SUPABASE_ANON_KEY,
  'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
  'STRIPE_SECRET_KEY': process.env.STRIPE_SECRET_KEY,
  'STRIPE_WEBHOOK_SECRET': process.env.STRIPE_WEBHOOK_SECRET_01,
  'KEEPER_BREAK_GLASS_TOKEN': process.env.KEEPER_BREAK_GLASS_TOKEN
};

console.log('\n📋 LOCAL ENVIRONMENT STATUS:');
Object.entries(localKeys).forEach(([key, value]) => {
  const status = value ? 'PRESENT' : 'MISSING';
  const preview = value ? `${value.substring(0, 10)}...` : 'N/A';
  console.log(`${status} ${key}: ${preview}`);
});

// Vercel environment keys (from your output)
console.log('\n📋 VERCEL ENVIRONMENT STATUS:');
console.log('✅ STRIPE_WEBHOOK_SECRET: Production (2d ago)');
console.log('✅ SUPABASE_SERVICE_ROLE_KEY: Development + Production (2d ago)');
console.log('✅ SUPABASE_URL: Development + Production (2d ago)');
console.log('❌ STRIPE_SECRET_KEY: NOT VISIBLE in Vercel');
console.log('❌ SUPABASE_ANON_KEY: NOT VISIBLE in Vercel');
console.log('❌ KEEPER_BREAK_GLASS_TOKEN: NOT VISIBLE in Vercel');

console.log('\n🚨 SYNC ISSUES IDENTIFIED:');
console.log('==========================');

// Check for potential mismatches
const issues = [];

if (!localKeys.STRIPE_SECRET_KEY) {
  issues.push('STRIPE_SECRET_KEY missing locally but may exist in Vercel');
}

if (!localKeys.KEEPER_BREAK_GLASS_TOKEN) {
  issues.push('KEEPER_BREAK_GLASS_TOKEN missing locally');
}

if (localKeys.SUPABASE_SERVICE_ROLE_KEY) {
  issues.push('SUPABASE_SERVICE_ROLE_KEY exists locally - check if matches Vercel');
}

if (issues.length === 0) {
  console.log('✅ No obvious sync issues detected');
} else {
  issues.forEach(issue => console.log(`❌ ${issue}`));
}

console.log('\n📋 RECOMMENDED ACTIONS:');
console.log('=======================');
console.log('1. Run: vercel env pull .env.production');
console.log('2. Compare .env vs .env.production');
console.log('3. Update missing keys in Vercel:');
console.log('   - vercel env add STRIPE_SECRET_KEY');
console.log('   - vercel env add KEEPER_BREAK_GLASS_TOKEN');
console.log('4. Test with: vercel env ls');
console.log('5. Redeploy if needed: vercel --prod');

console.log('\n🔐 SECURITY NOTE:');
console.log('===============');
console.log('Vercel shows "Encrypted" values - this is good.');
console.log('But 2d ago means these might be pre-rotation keys.');
console.log('Verify if you need to update Vercel secrets.');
