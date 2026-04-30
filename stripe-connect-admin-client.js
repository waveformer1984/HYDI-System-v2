#!/usr/bin/env node
/**
 * Client script for Stripe Connect Admin operations
 * Usage examples for managing client connected accounts
 */

const SUPABASE_URL = 'https://akbnfovjdcobifeupvbn.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/stripe-connect-admin`;

async function stripeConnectAdmin(action, data = {}) {
  console.log(`\n▶ ${action.toUpperCase()} - Stripe Connect Admin`);
  console.log('─'.repeat(50));

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...data })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Request failed');
    }

    console.log('✅ Success:');
    console.log(JSON.stringify(result.data, null, 2));
    return result.data;

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

// Example: Create a Connect account for Galactic Bytes
async function exampleCreateAccount() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Example: Create Connect Account for Galactic Bytes       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // First, we need the client_id from the database
  // For this example, we'll use a placeholder
  const clientId = 'galactic-bytes-client-id'; // Replace with actual client_id

  await stripeConnectAdmin('create', {
    client_id: clientId,
    account_data: {
      type: 'express',
      country: 'US',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      business_profile: {
        name: 'Galactic Bytes Inc',
        url: 'https://galacticbytes.com'
      }
    }
  });
}

// Example: List all Connect accounts
async function exampleListAccounts() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Example: List All Connect Accounts                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const accounts = await stripeConnectAdmin('list');
  
  console.log('\n📊 Connect Accounts Summary:');
  console.log('─'.repeat(80));
  accounts.forEach(acc => {
    console.log(`Client: ${acc.client_name || 'N/A'}`);
    console.log(`  Email: ${acc.email}`);
    console.log(`  Account ID: ${acc.stripe_account_id}`);
    console.log(`  Type: ${acc.account_type || 'N/A'}`);
    console.log(`  Charges Enabled: ${acc.charges_enabled ? '✅' : '❌'}`);
    console.log(`  Payouts Enabled: ${acc.payouts_enabled ? '✅' : '❌'}`);
    console.log(`  Status: ${acc.status}`);
    if (acc.error) {
      console.log(`  Error: ${acc.error}`);
    }
    console.log('─'.repeat(80));
  });
}

// Example: Retrieve a specific account
async function exampleRetrieveAccount(accountId) {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Example: Retrieve Specific Connect Account              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  await stripeConnectAdmin('retrieve', {
    account_id: accountId
  });
}

// Example: Create login link for client dashboard
async function exampleCreateLoginLink(accountId) {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Example: Create Login Link for Client                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const loginLink = await stripeConnectAdmin('create_login_link', {
    account_id: accountId,
    refresh_url: 'https://your-app.com/reconnect',
    return_url: 'https://your-app.com/return'
  });

  console.log('\n🔗 Login Link:');
  console.log(`URL: ${loginLink.url}`);
  console.log(`Created: ${new Date(loginLink.created * 1000).toLocaleString()}`);
  console.log(`Expires: ${loginLink.expires_at ? new Date(loginLink.expires_at * 1000).toLocaleString() : 'Never'}`);
}

// Example: Update account capabilities
async function exampleUpdateAccount(accountId) {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Example: Update Connect Account                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  await stripeConnectAdmin('update', {
    account_id: accountId,
    account_data: {
      business_profile: {
        url: 'https://updated-galacticbytes.com',
        mcc: '5734' // Computer Software Stores
      }
    }
  });
}

// Example: Delete an account (use with caution!)
async function exampleDeleteAccount(accountId) {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Example: Delete Connect Account                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('⚠️  WARNING: This will permanently delete the Connect account!');
  
  // In production, you might want to add confirmation here
  const confirmed = process.env.CONFIRM_DELETE === 'true';
  
  if (!confirmed) {
    console.log('Skipping delete - set CONFIRM_DELETE=true to proceed');
    return;
  }

  await stripeConnectAdmin('delete', {
    account_id: accountId
  });
}

// Main execution
async function main() {
  const command = process.argv[2];

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Stripe Connect Admin Client                             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  switch (command) {
    case 'list':
      await exampleListAccounts();
      break;
      
    case 'create':
      await exampleCreateAccount();
      break;
      
    case 'retrieve':
      const accountId = process.argv[3];
      if (!accountId) {
        console.error('Please provide account_id: node stripe-connect-admin-client.js retrieve <account_id>');
        process.exit(1);
      }
      await exampleRetrieveAccount(accountId);
      break;
      
    case 'login-link':
      const loginAccountId = process.argv[3];
      if (!loginAccountId) {
        console.error('Please provide account_id: node stripe-connect-admin-client.js login-link <account_id>');
        process.exit(1);
      }
      await exampleCreateLoginLink(loginAccountId);
      break;
      
    case 'update':
      const updateAccountId = process.argv[3];
      if (!updateAccountId) {
        console.error('Please provide account_id: node stripe-connect-admin-client.js update <account_id>');
        process.exit(1);
      }
      await exampleUpdateAccount(updateAccountId);
      break;
      
    case 'delete':
      const deleteAccountId = process.argv[3];
      if (!deleteAccountId) {
        console.error('Please provide account_id: node stripe-connect-admin-client.js delete <account_id>');
        process.exit(1);
      }
      await exampleDeleteAccount(deleteAccountId);
      break;
      
    default:
      console.log('\nUsage:');
      console.log('  node stripe-connect-admin-client.js list');
      console.log('  node stripe-connect-admin-client.js create');
      console.log('  node stripe-connect-admin-client.js retrieve <account_id>');
      console.log('  node stripe-connect-admin-client.js login-link <account_id>');
      console.log('  node stripe-connect-admin-client.js update <account_id>');
      console.log('  node stripe-connect-admin-client.js delete <account_id>');
      console.log('\nEnvironment variables:');
      console.log('  SUPABASE_SERVICE_ROLE_KEY (required)');
      console.log('  CONFIRM_DELETE=true (for delete operations)');
      break;
  }
}

main().catch(console.error);
