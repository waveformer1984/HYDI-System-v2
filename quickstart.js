/**
 * HYDI AppForge Integration — Quickstart
 * 
 * 1. Run SETUP_SQL in your AppForge admin Supabase
 * 2. Set environment variables
 * 3. Run: node quickstart.js
 */

const { AppForgeHydiIntegration, SETUP_SQL } = require('./appforge-hydi');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const ADMIN_SUPABASE_URL = process.env.ADMIN_SUPABASE_URL;
const ADMIN_SERVICE_KEY = process.env.ADMIN_SERVICE_KEY;

async function main() {
  console.log('🚀 HYDI AppForge Quickstart\n');

  // Validate env
  if (!ADMIN_SUPABASE_URL || !ADMIN_SERVICE_KEY) {
    console.error('❌ Missing environment variables:');
    console.error('  ADMIN_SUPABASE_URL=your-appforge-admin-url');
    console.error('  ADMIN_SERVICE_KEY=your-service-role-key');
    process.exit(1);
  }

  // Connect to AppForge admin Supabase
  const adminSupabase = createClient(ADMIN_SUPABASE_URL, ADMIN_SERVICE_KEY);
  const hydi = new AppForgeHydiIntegration(adminSupabase);

  console.log('✅ Connected to AppForge admin Supabase\n');

  // Example: Activate for a new client
  const exampleClient = {
    id: 'client_' + Date.now(),
    tier: 'growth',
    url: 'https://akbnfovjdcobifeupvbn.supabase.co',
    key: process.env.EXAMPLE_CLIENT_KEY || 'example-service-role-key'
  };

  console.log('📋 Example: Activating HYDI for new client...');
  console.log(`   Client ID: ${exampleClient.id}`);
  console.log(`   Tier: ${exampleClient.tier}`);
  console.log(`   Monthly: $${hydi.tiers[exampleClient.tier].monthly}\n`);

  try {
    const activation = await hydi.activateForClient(
      exampleClient.id,
      exampleClient.tier,
      exampleClient.url,
      exampleClient.key
    );

    console.log('✅ Activation complete!');
    console.log('Subscription:', activation.subscription);
    console.log('\nNext steps:');
    activation.next_steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step}`);
    });

  } catch (err) {
    console.error('❌ Activation failed:', err.message);
    console.log('\n💡 Make sure you ran SETUP_SQL first!');
    console.log('\n--- SETUP_SQL ---\n');
    console.log(SETUP_SQL);
    process.exit(1);
  }

  // Example: Get fleet summary
  console.log('\n📊 Fleet Summary:');
  try {
    const fleet = await hydi.getFleetSummary();
    console.log(`  Total clients: ${fleet.total}`);
    console.log(`  Healthy: ${fleet.healthy} ✅`);
    console.log(`  Warning: ${fleet.warning} 🟡`);
    console.log(`  Critical: ${fleet.critical} 🔴`);
    console.log(`  Total MRR: $${fleet.mrr}/mo`);
  } catch (err) {
    console.log('  (No clients yet — fleet summary will populate after first check)');
  }

  console.log('\n🎯 Revenue at scale:');
  console.log('  10 clients × $149 avg = $1,490/mo = $17,880/yr');
  console.log('  25 clients × $149 avg = $3,725/mo = $44,700/yr');
  console.log('  50 clients × $149 avg = $7,450/mo = $89,400/yr');

  console.log('\n✨ Setup complete! Ready to onboard AppForge clients.');
}

// Print setup SQL if requested
if (process.argv.includes('--setup-sql')) {
  console.log(SETUP_SQL);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
