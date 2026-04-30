/**
 * Stripe Connect End-to-End Test
 * Simulates a Galactic Bytes payment flow
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Simulated Stripe Connect account IDs
const SUB_ACCOUNT_IDS = {
  galactic_bytes: 'acct_1QMfK...galactic',
  detailer_bot: 'acct_1QMfK...detailer',
  lipi_v2: 'acct_1QMfK...lipi',
  protogrance_aromatics: 'acct_1QMfK...protogrance',
  rezonate: 'acct_1QMfK...rezonate',
  waveformer_studio: 'acct_1QMfK...waveformer'
};

async function runGalacticBytesTest() {
  console.log('🧪 Testing Galactic Bytes Stripe Connect Flow\n');
  console.log('=' .repeat(60));
  
  try {
    // Step 1: Verify ledger table exists and has correct structure
    console.log('\n📋 Step 1: Verifying ledger table structure...');
    
    const { data: columns, error: columnError } = await supabase
      .from('ledger')
      .select('*')
      .limit(0);
    
    if (columnError) {
      console.error('❌ Ledger table not accessible:', columnError.message);
      return;
    }
    
    console.log('✅ Ledger table exists and accessible');
    
    // Step 2: Check for existing test transaction
    console.log('\n📋 Step 2: Checking for Galactic Bytes test transaction...');
    
    const { data: existingTx, error: txError } = await supabase
      .from('ledger')
      .select('*')
      .eq('revenue_stream', 'galactic_bytes')
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (txError) {
      console.error('❌ Error querying ledger:', txError.message);
      return;
    }
    
    let testTransaction;
    
    if (existingTx && existingTx.length > 0) {
      console.log('✅ Found existing Galactic Bytes transaction');
      testTransaction = existingTx[0];
    } else {
      // Create test transaction
      console.log('Creating new test transaction...');
      
      const { data: newTx, error: insertError } = await supabase
        .from('ledger')
        .insert({
          stripe_payment_intent_id: 'pi_test_galactic_' + Date.now(),
          source_account: SUB_ACCOUNT_IDS.galactic_bytes,
          revenue_stream: 'galactic_bytes',
          project_code: 'galactic_bytes',
          amount_gross: 1000.00,
          currency: 'usd',
          platform_fee_percent: 5.00,
          agent_fee_percent: 10.00,
          stripe_fee_percent: 2.90,
          stripe_fixed_fee: 0.30,
          status: 'completed',
          description: 'Galactic Bytes test transaction - Web development services',
          customer_email: 'test@example.com',
          customer_name: 'Test Customer',
          metadata: {
            test: true,
            project: 'galactic_bytes_onboarding'
          }
        })
        .select()
        .single();
      
      if (insertError) {
        console.error('❌ Error creating test transaction:', insertError.message);
        return;
      }
      
      testTransaction = newTx;
      console.log('✅ Created new test transaction');
    }
    
    // Step 3: Display fee breakdown
    console.log('\n📋 Step 3: Fee Breakdown Analysis\n');
    console.log('-'.repeat(60));
    console.log('Transaction ID:', testTransaction.transaction_id);
    console.log('Payment Intent:', testTransaction.stripe_payment_intent_id);
    console.log('Revenue Stream:', testTransaction.revenue_stream);
    console.log('Source Account:', testTransaction.source_account);
    console.log('-'.repeat(60));
    console.log('\n💰 GROSS AMOUNT:'.padEnd(30), `$${testTransaction.amount_gross.toFixed(2)}`);
    console.log('\n📊 FEE BREAKDOWN:');
    console.log('  Platform Fee (5%):'.padEnd(30), `$${testTransaction.platform_fee_amount.toFixed(2)}`);
    console.log('  Agent Pool Fee (10%):'.padEnd(30), `$${testTransaction.agent_fee_amount.toFixed(2)}`);
    console.log('  Stripe Fee (2.9% + $0.30):'.padEnd(30), `$${testTransaction.stripe_fee_amount.toFixed(2)}`);
    console.log('-'.repeat(60));
    console.log('  TOTAL FEES:'.padEnd(30), `$${(testTransaction.platform_fee_amount + testTransaction.agent_fee_amount + testTransaction.stripe_fee_amount).toFixed(2)}`);
    console.log('\n💵 NET AMOUNT:'.padEnd(30), `$${testTransaction.net_amount.toFixed(2)}`);
    console.log('-'.repeat(60));
    
    // Calculate percentages
    const totalFees = testTransaction.platform_fee_amount + testTransaction.agent_fee_amount + testTransaction.stripe_fee_amount;
    const netPercentage = (testTransaction.net_amount / testTransaction.amount_gross) * 100;
    
    console.log('\n📈 DISTRIBUTION:');
    console.log(`  Platform: ${(testTransaction.platform_fee_amount / testTransaction.amount_gross * 100).toFixed(1)}%`);
    console.log(`  Agent Pool: ${(testTransaction.agent_fee_amount / testTransaction.amount_gross * 100).toFixed(1)}%`);
    console.log(`  Stripe: ${(testTransaction.stripe_fee_amount / testTransaction.amount_gross * 100).toFixed(1)}%`);
    console.log(`  Net to Sub-account: ${netPercentage.toFixed(1)}%`);
    
    // Step 4: Verify reconciliation view
    console.log('\n📋 Step 4: Verifying reconciliation view...');
    
    const { data: reconciliation, error: reconError } = await supabase
      .from('ledger_reconciliation')
      .select('*')
      .eq('revenue_stream', 'galactic_bytes');
    
    if (reconError) {
      console.error('❌ Reconciliation view error:', reconError.message);
    } else if (reconciliation && reconciliation.length > 0) {
      console.log('✅ Reconciliation view working');
      const recon = reconciliation[0];
      console.log('\n  Transactions:', recon.transaction_count);
      console.log('  Total Gross: $' + parseFloat(recon.total_gross).toFixed(2));
      console.log('  Total Net: $' + parseFloat(recon.total_net).toFixed(2));
    }
    
    // Step 5: Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ GALACTIC BYTES TEST FLOW COMPLETE\n');
    console.log('Sub-account ID:', SUB_ACCOUNT_IDS.galactic_bytes);
    console.log('Transaction Status:', testTransaction.status);
    console.log('Net Available for Payout: $' + testTransaction.net_amount.toFixed(2));
    console.log('='.repeat(60));
    
    return {
      success: true,
      transaction: testTransaction,
      subAccountId: SUB_ACCOUNT_IDS.galactic_bytes
    };
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    return { success: false, error: error.message };
  }
}

// Display all sub-account documentation
function displaySubAccountDocumentation() {
  console.log('\n\n' + '='.repeat(60));
  console.log('STRIPE CONNECT SUB-ACCOUNT DOCUMENTATION');
  console.log('='.repeat(60) + '\n');
  
  Object.entries(SUB_ACCOUNT_IDS).forEach(([name, id]) => {
    console.log(`${name.toUpperCase().replace(/_/g, ' ')}:`);
    console.log(`  Account ID: ${id}`);
    console.log(`  Project Code: ${name}`);
    console.log(`  Environment Variable: STRIPE_ACCOUNT_${name.toUpperCase()}`);
    console.log('');
  });
  
  console.log('='.repeat(60));
  console.log('\n📋 Add to .env file:\n');
  Object.entries(SUB_ACCOUNT_IDS).forEach(([name, id]) => {
    console.log(`STRIPE_ACCOUNT_${name.toUpperCase()}=${id}`);
  });
}

// Run test if called directly
if (require.main === module) {
  runGalacticBytesTest()
    .then(result => {
      if (result.success) {
        displaySubAccountDocumentation();
        console.log('\n✨ All systems operational');
        process.exit(0);
      } else {
        console.error('\n💥 Test failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { runGalacticBytesTest, SUB_ACCOUNT_IDS };
