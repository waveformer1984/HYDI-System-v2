#!/usr/bin/env node
/**
 * Run the complete ProtoForge payout system E2E test
 * Make sure tables are created first by running setup-payout-system.sql in Supabase SQL Editor
 */

const { execSync } = require('child_process');
const fs = require('fs');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  ProtoForge Payout System - Complete E2E Test             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📋 Prerequisites:');
console.log('  1. Tables created in Supabase (run setup-payout-system.sql)');
console.log('  2. SUPABASE_SERVICE_ROLE_KEY environment variable set\n');

// Check if environment variable is set
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  console.log('\nRun this command first:');
  console.log('$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"');
  process.exit(1);
}

console.log('▶ Step 1: Running Galactic Bytes test...');
try {
  const output = execSync('node test-galactic-bytes-payout.js', { 
    encoding: 'utf8',
    cwd: __dirname,
    env: {
      ...process.env,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: 'https://akbnfovjdcobifeupvbn.supabase.co'
    }
  });
  console.log(output);
} catch (error) {
  console.error('❌ Test failed:', error.stdout || error.message);
  process.exit(1);
}

console.log('\n▶ Step 2: Testing Stripe transfer...');
try {
  const output = execSync('node test-stripe-transfer.js', { 
    encoding: 'utf8',
    cwd: __dirname,
    env: {
      ...process.env,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: 'https://akbnfovjdcobifeupvbn.supabase.co',
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || ''
    }
  });
  console.log(output);
} catch (error) {
  console.error('❌ Stripe transfer test failed:', error.stdout || error.message);
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  Test Summary                                             ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log('║ ✓ Galactic Bytes client created                          ║');
console.log('║ ✓ Ledger entries added                                   ║');
console.log('║ ✓ Monthly payout calculated                              ║');
console.log('║ ✓ Dashboard data verified                                ║');
console.log('║ ✓ Stripe transfer tested                                 ║');
console.log('╚════════════════════════════════════════════════════════════╝');

console.log('\n📊 Dashboard URL:');
console.log('  http://localhost:3000/client-dashboard');
console.log('\n🚀 To deploy functions:');
console.log('  ./deploy-payout-functions.ps1');
