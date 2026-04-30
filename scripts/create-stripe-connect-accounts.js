/**
 * Stripe Connect Sub-Account Creation Script
 * Creates Connected Accounts for each ProtoForge revenue stream
 */

const Stripe = require('stripe');
require('dotenv').config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const REVENUE_STREAMS = [
  { name: 'Galactic Bytes', description: 'Web development and digital services' },
  { name: 'Detailer Bot', description: 'AI-powered detailing automation' },
  { name: 'LiPi v2', description: 'Lightweight personal intelligence system' },
  { name: 'ProtoGrance Aromatics', description: 'Scent and aroma technology' },
  { name: 'Rezonate', description: 'Audio and resonance solutions' },
  { name: 'Waveformer Studio', description: 'Waveform and signal processing' }
];

async function createConnectAccounts() {
  console.log('🏦 Creating Stripe Connect sub-accounts for ProtoForge revenue streams...\n');
  
  const accounts = [];
  
  for (const stream of REVENUE_STREAMS) {
    try {
      console.log(`Creating account for: ${stream.name}...`);
      
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        business_type: 'company',
        company: {
          name: `${stream.name} - ProtoForge Subsidiary`,
        },
        metadata: {
          revenue_stream: stream.name,
          project_code: stream.name.toLowerCase().replace(/\s+/g, '_'),
          description: stream.description,
          created_by: 'protoforge_setup_script',
          created_at: new Date().toISOString()
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        settings: {
          payouts: {
            schedule: {
              interval: 'manual' // We control when payouts happen
            }
          }
        }
      });
      
      accounts.push({
        name: stream.name,
        account_id: account.id,
        project_code: stream.name.toLowerCase().replace(/\s+/g, '_'),
        description: stream.description,
        created_at: new Date().toISOString()
      });
      
      console.log(`✅ Created: ${stream.name}`);
      console.log(`   Account ID: ${account.id}`);
      console.log(`   Status: ${account.charges_enabled ? 'Charges Enabled' : 'Pending'}\n`);
      
    } catch (error) {
      console.error(`❌ Failed to create account for ${stream.name}:`, error.message);
    }
  }
  
  // Save account documentation
  const fs = require('fs');
  const outputPath = './stripe-connect-accounts.json';
  fs.writeFileSync(outputPath, JSON.stringify(accounts, null, 2));
  
  console.log('\n📋 STRIPE CONNECT ACCOUNT DOCUMENTATION');
  console.log('=====================================\n');
  
  accounts.forEach(acc => {
    console.log(`${acc.name}:`);
    console.log(`  Account ID: ${acc.account_id}`);
    console.log(`  Project Code: ${acc.project_code}`);
    console.log(`  Description: ${acc.description}`);
    console.log('');
  });
  
  console.log(`\n💾 Account data saved to: ${outputPath}`);
  
  // Generate .env additions
  console.log('\n📝 Add these to your .env file:\n');
  accounts.forEach(acc => {
    const envVar = `STRIPE_ACCOUNT_${acc.project_code.toUpperCase()}`;
    console.log(`${envVar}=${acc.account_id}`);
  });
  
  return accounts;
}

// Execute if run directly
if (require.main === module) {
  createConnectAccounts()
    .then(accounts => {
      console.log(`\n✨ Successfully created ${accounts.length} Stripe Connect accounts`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { createConnectAccounts, REVENUE_STREAMS };
