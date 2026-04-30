/**
 * Worker Setup Status
 * Shows what needs to be configured to run the worker system
 */

require('dotenv').config();

console.log('🔍 HYDI Worker System Setup Status\n');

// Check environment variables
const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET_01'
];

let allGood = true;

console.log('📋 Environment Variables:');
requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (!value || value === 'YOUR_SERVICE_ROLE_KEY_HERE') {
        console.log(`   ❌ ${varName}: Missing or invalid`);
        allGood = false;
    } else {
        console.log(`   ✅ ${varName}: Present`);
    }
});

console.log('\n📊 Database Tables:');
const tables = [
    'worker_queues',
    'worker_status', 
    'worker_events',
    'webhook_events',
    'event_subscriptions'
];

// We can't check tables without proper credentials, so we'll just show what's needed
console.log('   ℹ️  Run these SQL files in Supabase dashboard:');
console.log('      1. workers/queue-system.sql');
console.log('      2. workers-schema.sql');

console.log('\n🚀 Next Steps:');
if (!allGood) {
    console.log('1. Get your Supabase Service Role Key from:');
    console.log('   Supabase Dashboard → Project Settings → API → service_role');
    console.log('2. Update the .env file with the correct key');
    console.log('3. Get your Stripe Secret Key from Stripe Dashboard');
    console.log('4. Run: node start-workers.js');
} else {
    console.log('✅ All environment variables are set!');
    console.log('Run: node start-workers.js');
}

console.log('\n📝 For manual database setup:');
console.log('1. Go to https://supabase.com/dashboard');
console.log('2. Select your project');
console.log('3. Go to SQL Editor');
console.log('4. Paste and run workers/queue-system.sql');
console.log('5. Paste and run workers-schema.sql');
