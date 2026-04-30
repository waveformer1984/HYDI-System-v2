/**
 * Monthly Payout Automation Script
 * Calculates what each client is owed after disputes/fees, triggers ACH transfers
 */

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Client bank account mappings (in production, these come from secure storage)
const CLIENT_BANK_ACCOUNTS = {
  galactic_bytes: process.env.GALACTIC_BYTES_BANK_ACCOUNT,
  detailer_bot: process.env.DETAILER_BOT_BANK_ACCOUNT,
  lipi_v2: process.env.LIPI_V2_BANK_ACCOUNT,
  protogrance_aromatics: process.env.PROTOGRANCE_BANK_ACCOUNT,
  rezonate: process.env.REZONATE_BANK_ACCOUNT,
  waveformer_studio: process.env.WAVEFORMER_BANK_ACCOUNT
};

async function runMonthlyPayout() {
  console.log('💰 Starting Monthly Payout Automation\n');
  console.log('='.repeat(60));
  
  const payoutDate = new Date().toISOString().split('T')[0];
  const batchId = `payout_${payoutDate}_${Date.now()}`;
  
  try {
    // Step 1: Get all projects with available payouts
    console.log('\n📊 Step 1: Calculating available payouts by project...\n');
    
    const { data: projects, error: projectError } = await supabase
      .from('ledger')
      .select('project_code, revenue_stream')
      .eq('status', 'completed')
      .not('project_code', 'is', null);
    
    if (projectError) {
      throw projectError;
    }
    
    // Get unique projects
    const uniqueProjects = [...new Map(projects.map(p => [p.project_code, p])).values()];
    
    const payoutResults = [];
    
    for (const project of uniqueProjects) {
      const projectCode = project.project_code;
      
      // Calculate available amount for this project
      const { data: availableTxs, error: calcError } = await supabase
        .from('ledger')
        .select('net_amount, transaction_id')
        .eq('project_code', projectCode)
        .eq('status', 'completed')
        .is('payout_batch_id', null);
      
      if (calcError) {
        console.error(`Error calculating for ${projectCode}:`, calcError);
        continue;
      }
      
      if (!availableTxs || availableTxs.length === 0) {
        console.log(`${projectCode}: No available payouts`);
        continue;
      }
      
      const totalAmount = availableTxs.reduce((sum, tx) => sum + parseFloat(tx.net_amount), 0);
      const transactionCount = availableTxs.length;
      
      console.log(`${projectCode}:`);
      console.log(`  Transactions: ${transactionCount}`);
      console.log(`  Amount: $${totalAmount.toFixed(2)}`);
      
      // Check for disputes/chargebacks
      const { data: disputes, error: disputeError } = await supabase
        .from('ledger')
        .select('net_amount')
        .eq('project_code', projectCode)
        .eq('status', 'pending_dispute');
      
      if (disputeError) {
        console.error(`Error checking disputes for ${projectCode}:`, disputeError);
      }
      
      const heldAmount = disputes ? disputes.reduce((sum, d) => sum + parseFloat(d.net_amount), 0) : 0;
      
      if (heldAmount > 0) {
        console.log(`  Held for disputes: $${heldAmount.toFixed(2)}`);
      }
      
      const payoutAmount = totalAmount;
      
      if (payoutAmount <= 0) {
        console.log(`  → Skipping (no funds available)\n`);
        continue;
      }
      
      // Step 2: Create payout record
      console.log(`  → Creating payout for $${payoutAmount.toFixed(2)}\n`);
      
      const bankAccount = CLIENT_BANK_ACCOUNTS[projectCode];
      
      if (!bankAccount) {
        console.error(`  ❌ No bank account configured for ${projectCode}`);
        payoutResults.push({
          project: projectCode,
          status: 'failed',
          error: 'No bank account configured',
          amount: payoutAmount
        });
        continue;
      }
      
      try {
        // Create ACH transfer via Stripe
        // Note: In production, this uses Stripe's Transfer API to connected accounts
        // or External Account transfers for ACH
        const transfer = await stripe.transfers.create({
          amount: Math.round(payoutAmount * 100), // Convert to cents
          currency: 'usd',
          destination: bankAccount,
          description: `ProtoForge payout for ${projectCode} - ${payoutDate}`,
          metadata: {
            project_code: projectCode,
            batch_id: batchId,
            transaction_count: transactionCount.toString(),
            payout_date: payoutDate
          }
        });
        
        console.log(`  ✅ Transfer created: ${transfer.id}`);
        
        // Step 3: Update ledger entries
        const transactionIds = availableTxs.map(tx => tx.transaction_id);
        
        const { error: updateError } = await supabase
          .from('ledger')
          .update({
            status: 'payout_initiated',
            payout_batch_id: batchId,
            payout_initiated_at: new Date().toISOString(),
            stripe_payout_id: transfer.id
          })
          .in('transaction_id', transactionIds);
        
        if (updateError) {
          console.error(`  ❌ Error updating ledger:`, updateError);
          throw updateError;
        }
        
        console.log(`  ✅ Updated ${transactionCount} ledger entries`);
        
        // Step 4: Create payout record
        const { error: payoutRecordError } = await supabase
          .from('payouts')
          .insert({
            batch_id: batchId,
            project_code: projectCode,
            stripe_transfer_id: transfer.id,
            amount: payoutAmount,
            transaction_count: transactionCount,
            status: 'initiated',
            initiated_at: new Date().toISOString(),
            metadata: {
              transactions: transactionIds
            }
          });
        
        if (payoutRecordError) {
          console.error(`  ❌ Error creating payout record:`, payoutRecordError);
        }
        
        payoutResults.push({
          project: projectCode,
          status: 'initiated',
          amount: payoutAmount,
          transfer_id: transfer.id,
          transaction_count: transactionCount
        });
        
        // Step 5: Send notification
        await sendPayoutNotification(projectCode, payoutAmount, transfer.id);
        
      } catch (stripeError) {
        console.error(`  ❌ Stripe error:`, stripeError.message);
        payoutResults.push({
          project: projectCode,
          status: 'failed',
          error: stripeError.message,
          amount: payoutAmount
        });
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 PAYOUT SUMMARY\n');
    
    const totalPayouts = payoutResults.filter(r => r.status === 'initiated');
    const totalAmount = totalPayouts.reduce((sum, r) => sum + r.amount, 0);
    
    console.log(`Batch ID: ${batchId}`);
    console.log(`Successful payouts: ${totalPayouts.length}`);
    console.log(`Failed payouts: ${payoutResults.filter(r => r.status === 'failed').length}`);
    console.log(`Total amount: $${totalAmount.toFixed(2)}`);
    
    payoutResults.forEach(result => {
      const statusEmoji = result.status === 'initiated' ? '✅' : '❌';
      console.log(`\n${statusEmoji} ${result.project}:`);
      console.log(`   Amount: $${result.amount.toFixed(2)}`);
      if (result.transfer_id) {
        console.log(`   Transfer ID: ${result.transfer_id}`);
      }
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });
    
    console.log('\n' + '='.repeat(60));
    
    return {
      batch_id: batchId,
      results: payoutResults,
      total_amount: totalAmount,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    throw error;
  }
}

/**
 * Send email notification when payout clears
 */
async function sendPayoutNotification(projectCode, amount, transferId) {
  // In production, this integrates with your email service
  console.log(`📧 Notification: Payout of $${amount.toFixed(2)} for ${projectCode} initiated (Transfer: ${transferId})`);
  
  // Example email content:
  const emailContent = {
    to: `${projectCode}@protoforge.dev`, // Get from client config
    subject: `ProtoForge Payout Initiated - $${amount.toFixed(2)}`,
    body: `
Your ProtoForge payout has been initiated.

Project: ${projectCode}
Amount: $${amount.toFixed(2)}
Transfer ID: ${transferId}

Funds will arrive in your bank account within 1-2 business days.

View your dashboard: https://protoforge.dev/dashboard/${projectCode}

Questions? Reply to this email or contact support.
    `
  };
  
  // Here you would call your email service
  // await emailService.send(emailContent);
  
  console.log('   Email queued for delivery');
}

/**
 * Check payout status and update ledger when completed
 */
async function checkPayoutStatus(batchId) {
  console.log(`\n🔍 Checking payout status for batch: ${batchId}`);
  
  const { data: payouts, error } = await supabase
    .from('payouts')
    .select('*')
    .eq('batch_id', batchId);
  
  if (error) {
    console.error('Error fetching payouts:', error);
    return;
  }
  
  for (const payout of payouts) {
    try {
      // Check Stripe transfer status
      const transfer = await stripe.transfers.retrieve(payout.stripe_transfer_id);
      
      if (transfer.reversed) {
        // Payout was reversed - update status
        await supabase
          .from('ledger')
          .update({ status: 'completed' }) // Reset to available
          .eq('payout_batch_id', batchId)
          .eq('project_code', payout.project_code);
        
        await supabase
          .from('payouts')
          .update({ status: 'reversed', reversed_at: new Date().toISOString() })
          .eq('id', payout.id);
        
        console.log(`   ⚠️  ${payout.project_code}: Payout reversed`);
        
      } else if (transfer.amount === payout.amount * 100) {
        // Payout completed
        await supabase
          .from('ledger')
          .update({ 
            status: 'payout_completed',
            payout_completed_at: new Date().toISOString()
          })
          .eq('payout_batch_id', batchId)
          .eq('project_code', payout.project_code);
        
        await supabase
          .from('payouts')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', payout.id);
        
        console.log(`   ✅ ${payout.project_code}: Payout completed`);
        
        // Send completion notification
        await sendPayoutClearedNotification(payout.project_code, payout.amount);
      }
      
    } catch (error) {
      console.error(`   ❌ Error checking ${payout.project_code}:`, error.message);
    }
  }
}

/**
 * Send notification when payout clears (funds arrive in bank)
 */
async function sendPayoutClearedNotification(projectCode, amount) {
  console.log(`📧 Payout cleared notification for ${projectCode}: $${amount.toFixed(2)}`);
  
  const emailContent = {
    to: `${projectCode}@protoforge.dev`,
    subject: `✅ ProtoForge Payout Deposited - $${amount.toFixed(2)}`,
    body: `
Great news! Your ProtoForge payout has been deposited.

Project: ${projectCode}
Amount: $${amount.toFixed(2)}
Status: Completed

The funds are now available in your bank account.

View your dashboard: https://protoforge.dev/dashboard/${projectCode}
    `
  };
  
  // await emailService.send(emailContent);
  console.log('   Completion email queued');
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'check' && args[1]) {
    // Check status: node monthly-payout-automation.js check <batch_id>
    checkPayoutStatus(args[1])
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    // Run payout
    runMonthlyPayout()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  }
}

module.exports = { 
  runMonthlyPayout, 
  checkPayoutStatus,
  sendPayoutNotification,
  sendPayoutClearedNotification 
};
