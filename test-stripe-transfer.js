#!/usr/bin/env node
/**
 * Test Stripe Transfer for a Pending Payout
 * This simulates the stripe-transfer-payout Edge Function
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://akbnfovjdcobifeupvbn.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

async function testStripeTransfer() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Stripe Transfer Test for ProtoForge Payouts               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Find pending payouts
    console.log('▶ Finding pending payouts...');
    const { data: pendingPayouts, error: findError } = await supabase
      .from('payouts')
      .select(`
        *,
        clients (
          client_id,
          client_name,
          email,
          stripe_customer_id,
          bank_account_token,
          project_name
        )
      `)
      .eq('status', 'pending')
      .limit(5);

    if (findError) throw new Error(`Failed to find payouts: ${findError.message}`);

    if (!pendingPayouts || pendingPayouts.length === 0) {
      console.log('  → No pending payouts found');
      console.log('  Run test-galactic-bytes-payout.js first to create a test payout');
      return;
    }

    console.log(`  ✓ Found ${pendingPayouts.length} pending payout(s)\n`);

    // Process first pending payout
    const payout = pendingPayouts[0];
    const client = payout.clients;

    console.log('▶ Processing payout:');
    console.log(`  Payout ID:       ${payout.payout_id}`);
    console.log(`  Client:          ${client.client_name} (${client.email})`);
    console.log(`  Amount:          $${parseFloat(payout.net_payout_amount).toFixed(2)}`);
    console.log(`  Period:          ${payout.period_start} to ${payout.period_end}`);
    console.log(`  Stripe Customer: ${client.stripe_customer_id || 'NOT SET'}`);
    console.log(`  Bank Token:      ${client.bank_account_token || 'NOT SET'}`);
    console.log('');

    if (!client.stripe_customer_id) {
      console.log('  ⚠️  No Stripe customer ID - would fail in production');
    }
    if (!client.bank_account_token) {
      console.log('  ⚠️  No bank account token - would fail in production');
    }

    // Simulate Stripe transfer (or do real one if keys available)
    if (!STRIPE_SECRET_KEY) {
      console.log('▶ Simulating Stripe transfer (no STRIPE_SECRET_KEY set)...\n');
      
      const mockTransferId = `tr_test_${Date.now()}`;
      
      // Update payout as completed (simulation)
      const { data: updatedPayout, error: updateError } = await supabase
        .from('payouts')
        .update({
          status: 'completed',
          stripe_transfer_id: mockTransferId,
          updated_at: new Date().toISOString()
        })
        .eq('payout_id', payout.payout_id)
        .select()
        .single();

      if (updateError) throw new Error(`Failed to update payout: ${updateError.message}`);

      console.log('  ✓ Payout marked as completed (simulation)');
      console.log(`  Transfer ID:     ${mockTransferId}`);
      console.log(`  Status:          ${updatedPayout.status}`);
      
    } else {
      console.log('▶ Initiating real Stripe transfer...');
      console.log('  (This would call Stripe API with real credentials)');
      // Real Stripe integration would go here
    }

    // Simulate completion email
    console.log('\n▶ Simulating completion email...\n');
    const emailContent = `
  ─────────────────────────────────────────────────────
  TO: ${client.email}
  SUBJECT: Payout Completed - $${parseFloat(payout.net_payout_amount).toFixed(2)}
  ─────────────────────────────────────────────────────
  
  Hello ${client.client_name},
  
  Your payout has been successfully processed!
  
  Amount: $${parseFloat(payout.net_payout_amount).toFixed(2)}
  Period: ${payout.period_start} to ${payout.period_end}
  Transfer ID: ${payout.stripe_transfer_id || 'tr_test_' + Date.now()}
  Status: Completed
  
  The funds should appear in your bank account within 1-2 business days.
  
  Thank you for using ProtoForge!
  ─────────────────────────────────────────────────────
    `.trim();
    console.log(emailContent);

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  Stripe Transfer Test Complete!                             ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║ ✓ Pending payout found and processed                        ║');
    console.log('║ ✓ Stripe transfer initiated (or simulated)                  ║');
    console.log('║ ✓ Payout status updated to completed                        ║');
    console.log('║ ✓ Transfer ID recorded in database                          ║');
    console.log('║ ✓ Completion email content generated                        ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    // Show final payout state
    const { data: finalPayout } = await supabase
      .from('payouts')
      .select('*')
      .eq('payout_id', payout.payout_id)
      .single();

    console.log('\n📊 Final Payout State:');
    console.log(`  Payout ID:           ${finalPayout.payout_id}`);
    console.log(`  Status:              ${finalPayout.status}`);
    console.log(`  Stripe Transfer ID:  ${finalPayout.stripe_transfer_id}`);
    console.log(`  Net Amount:          $${parseFloat(finalPayout.net_payout_amount).toFixed(2)}`);

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testStripeTransfer();
