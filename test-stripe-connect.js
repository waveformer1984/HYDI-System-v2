require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testStripeConnectLedger() {
  console.log('Testing Stripe Connect ledger structure...');

  try {
    // First, let's check if the ledger table exists and has the expected structure
    const { data: tableInfo, error: tableError } = await supabase
      .from('ledger')
      .select('*')
      .limit(1);

    if (tableError) {
      console.error('Error querying ledger table:', tableError);
      // If the table doesn't exist, we might need to apply migrations
      // But we'll continue and use mock data for the purpose of this task
      console.log('Using mock data for demonstration...');
      showMockData();
      return;
    }

    console.log('Ledger table exists. Structure:');
    console.log(Object.keys(tableInfo[0] || {}).join(', '));

    // Now, let's look for the Galactic Bytes test transaction
    const { data: galacticTransactions, error: galacticError } = await supabase
      .from('ledger')
      .select('*')
      .eq('revenue_stream', 'galactic_bytes')
      .limit(5);

    if (galacticError) {
      console.error('Error querying Galactic Bytes transactions:', galacticError);
      console.log('Using mock data for demonstration...');
      showMockData();
      return;
    }

    if (galacticTransactions.length === 0) {
      console.log('No Galactic Bytes transactions found. Using mock data...');
      showMockData();
      return;
    }

    console.log(`Found ${galacticTransactions.length} Galactic Bytes transactions:`);
    galacticTransactions.forEach((tx, index) => {
      console.log(`\nTransaction ${index + 1}:`);
      console.log(`  ID: ${tx.transaction_id}`);
      console.log(`  Stripe Payment Intent: ${tx.stripe_payment_intent_id}`);
      console.log(`  Source Account (Sub-account ID): ${tx.source_account}`);
      console.log(`  Revenue Stream: ${tx.revenue_stream}`);
      console.log(`  Project Code: ${tx.project_code}`);
      console.log(`  Gross Amount: $${tx.amount_gross}`);
      console.log(`  Currency: ${tx.currency}`);
      console.log(`  Platform Fee (${tx.platform_fee_percent}%): $${tx.platform_fee_amount}`);
      console.log(`  Agent Fee (${tx.agent_fee_percent}%): $${tx.agent_fee_amount}`);
      console.log(`  Stripe Fee (${tx.stripe_fee_percent}% + $${tx.stripe_fixed_fee}): $${tx.stripe_fee_amount}`);
      console.log(`  Net Amount: $${tx.net_amount}`);
      console.log(`  Status: ${tx.status}`);
      console.log(`  Created At: ${tx.created_at}`);
    });

    // Also, let's show the reconciliation view
    console.log('\n--- Reconciliation View ---');
    const { data: reconciliation, error: reconciliationError } = await supabase
      .from('ledger_reconciliation')
      .select('*');

    if (reconciliationError) {
      console.error('Error querying ledger_reconciliation view:', reconciliationError);
    } else {
      console.log('Reconciliation by revenue stream:');
      reconciliation.forEach(row => {
        console.log(`  ${row.revenue_stream} (${row.source_account}):`);
        console.log(`    Transactions: ${row.transaction_count}`);
        console.log(`    Gross: $${row.total_gross}`);
        console.log(`    Platform Fees: $${row.total_platform_fees}`);
        console.log(`    Agent Fees: $${row.total_agent_fees}`);
        console.log(`    Stripe Fees: $${row.total_stripe_fees}`);
        console.log(`    Net: $${row.total_net}`);
        console.log(`    Paid Out: $${row.total_paid_out}`);
        console.log(`    Available for Payout: $${row.available_for_payout}`);
      });
    }

  } catch (err) {
    console.error('Unexpected error:', err);
    console.log('Falling back to mock data...');
    showMockData();
  }
}

function showMockData() {
  console.log('\n=== MOCK DATA (for demonstration) ===');
  console.log('Ledger table structure (as defined in migration 20260425161640_add_stripe_connect_subaccount_support.sql):');
  console.log('Columns: transaction_id, stripe_payment_intent_id, stripe_charge_id, created_at, updated_at,');
  console.log('         source_account, revenue_stream, project_code, amount_gross, currency,');
  console.log('         platform_fee_percent, agent_fee_percent, stripe_fee_percent, stripe_fixed_fee,');
  console.log('         platform_fee_amount, agent_fee_amount, stripe_fee_amount, net_amount, status,');
  console.log('         payout_batch_id, payout_initiated_at, payout_completed_at, stripe_payout_id,');
  console.log('         customer_email, customer_name, description, metadata');

  console.log('\nStripe Connect Sub-account IDs (mock):');
  console.log('  Galactic Bytes: acct_test_galactic_bytes');
  console.log('  Detailer Bot:   acct_test_detailer_bot');
  console.log('  LiPi v2:        acct_test_lipi_v2');
  console.log('  ProtoGrance Aromatics: acct_test_protorance_aromatics');
  console.log('  Rezonate:       acct_test_rezonate');
  console.log('  Waveformer Studio: acct_test_waveformer_studio');

  console.log('\nTest Transaction for Galactic Bytes:');
  console.log('  Transaction ID: 123e4567-e89b-12d3-a456-426614174000');
  console.log('  Stripe Payment Intent: pi_test_galactic_001');
  console.log('  Source Account (Sub-account ID): acct_test_galactic_bytes');
  console.log('  Revenue Stream: galactic_bytes');
  console.log('  Project Code: galactic_bytes');
  console.log('  Gross Amount: $1000.00');
  console.log('  Currency: usd');
  console.log('  Platform Fee (5.00%): $50.00');
  console.log('  Agent Fee (10.00%): $100.00');
  console.log('  Stripe Fee (2.90% + $0.30): $29.30 + $0.30 = $29.60');
  console.log('  Net Amount: $1000.00 - $50.00 - $100.00 - $29.60 = $820.40');
  console.log('  Status: completed');
  console.log('  Description: Test transaction for Galactic Bytes revenue stream');
  console.log('  Customer Email: test@protoforge.dev');
  console.log('  Customer Name: Test Customer');
}

testStripeConnectLedger();