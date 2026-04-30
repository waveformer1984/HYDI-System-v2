/**
 * Stripe Connect Webhook Handler
 * Routes payments to correct sub-account and writes ledger entries
 */

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Revenue stream to Stripe Connect account mapping
const REVENUE_STREAM_ACCOUNTS = {
  'galactic_bytes': process.env.STRIPE_ACCOUNT_GALACTIC_BYTES,
  'detailer_bot': process.env.STRIPE_ACCOUNT_DETAILER_BOT,
  'lipi_v2': process.env.STRIPE_ACCOUNT_LIPI_V2,
  'protogrance_aromatics': process.env.STRIPE_ACCOUNT_PROTOGRANCE_AROMATICS,
  'rezonate': process.env.STRIPE_ACCOUNT_REZONATE,
  'waveformer_studio': process.env.STRIPE_ACCOUNT_WAVEFORMER_STUDIO
};

// Fee structure
const FEE_STRUCTURE = {
  platform_fee_percent: 5.00,
  agent_fee_percent: 10.00,
  stripe_fee_percent: 2.90,
  stripe_fixed_fee: 0.30
};

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log(`[Stripe Connect Webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;
        
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object);
        break;
        
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object);
        break;
        
      case 'payout.created':
        await handlePayoutCreated(event.data.object);
        break;
        
      case 'payout.paid':
        await handlePayoutPaid(event.data.object);
        break;
        
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Handle successful payment intent
 * Routes to correct sub-account and creates ledger entry
 */
async function handlePaymentIntentSucceeded(paymentIntent) {
  console.log(`[Webhook] Processing successful payment: ${paymentIntent.id}`);
  
  // Determine which revenue stream this belongs to
  const revenueStream = determineRevenueStream(paymentIntent);
  const connectAccountId = REVENUE_STREAM_ACCOUNTS[revenueStream];
  
  if (!connectAccountId) {
    console.error(`Unknown revenue stream: ${revenueStream}`);
    throw new Error(`Cannot route payment - unknown revenue stream: ${revenueStream}`);
  }

  // Get charge details for fee calculation
  const charge = paymentIntent.latest_charge 
    ? await stripe.charges.retrieve(paymentIntent.latest_charge, {
        stripeAccount: connectAccountId
      })
    : null;

  // Calculate fees
  const amountGross = paymentIntent.amount / 100; // Convert from cents
  const platformFee = (amountGross * FEE_STRUCTURE.platform_fee_percent) / 100;
  const agentFee = (amountGross * FEE_STRUCTURE.agent_fee_percent) / 100;
  const stripeFee = (amountGross * FEE_STRUCTURE.stripe_fee_percent) / 100 + FEE_STRUCTURE.stripe_fixed_fee;
  const netAmount = amountGross - platformFee - agentFee - stripeFee;

  console.log(`[Webhook] Fee breakdown for ${revenueStream}:`);
  console.log(`  Gross: $${amountGross.toFixed(2)}`);
  console.log(`  Platform fee (5%): $${platformFee.toFixed(2)}`);
  console.log(`  Agent fee (10%): $${agentFee.toFixed(2)}`);
  console.log(`  Stripe fee (2.9% + $0.30): $${stripeFee.toFixed(2)}`);
  console.log(`  Net: $${netAmount.toFixed(2)}`);

  // Create ledger entry
  const { data: ledgerEntry, error } = await supabase
    .from('ledger')
    .insert({
      stripe_payment_intent_id: paymentIntent.id,
      stripe_charge_id: charge?.id || null,
      source_account: connectAccountId,
      revenue_stream: revenueStream,
      project_code: revenueStream,
      amount_gross: amountGross,
      currency: paymentIntent.currency.toLowerCase(),
      platform_fee_percent: FEE_STRUCTURE.platform_fee_percent,
      agent_fee_percent: FEE_STRUCTURE.agent_fee_percent,
      stripe_fee_percent: FEE_STRUCTURE.stripe_fee_percent,
      stripe_fixed_fee: FEE_STRUCTURE.stripe_fixed_fee,
      status: 'completed',
      description: paymentIntent.description || `Payment for ${revenueStream}`,
      customer_email: paymentIntent.receipt_email || charge?.billing_details?.email || null,
      customer_name: charge?.billing_details?.name || null,
      metadata: {
        stripe_event: 'payment_intent.succeeded',
        client_reference_id: paymentIntent.client_secret,
        shipping: paymentIntent.shipping || null
      }
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating ledger entry:', error);
    throw error;
  }

  console.log(`[Webhook] Ledger entry created: ${ledgerEntry.transaction_id}`);
  
  // Emit event for ProtoForge agents
  await emitPaymentEvent(ledgerEntry, revenueStream);
  
  return ledgerEntry;
}

/**
 * Handle failed payment intent
 */
async function handlePaymentIntentFailed(paymentIntent) {
  console.log(`[Webhook] Payment failed: ${paymentIntent.id}`);
  
  // Mark any existing ledger entry as failed
  const { error } = await supabase
    .from('ledger')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (error) {
    console.error('Error updating ledger entry:', error);
  }
}

/**
 * Handle charge refund
 */
async function handleChargeRefunded(charge) {
  console.log(`[Webhook] Charge refunded: ${charge.id}`);
  
  // Update ledger entry status
  const { error } = await supabase
    .from('ledger')
    .update({ 
      status: 'refunded',
      metadata: { 
        refund_amount: charge.amount_refunded / 100,
        refund_reason: charge.refunds?.data[0]?.reason || 'customer_request'
      }
    })
    .eq('stripe_charge_id', charge.id);

  if (error) {
    console.error('Error updating ledger entry for refund:', error);
  }
}

/**
 * Handle payout created (from Stripe Connect)
 */
async function handlePayoutCreated(payout) {
  console.log(`[Webhook] Payout created: ${payout.id}`);
  
  // Update ledger entries for this payout batch
  const { error } = await supabase
    .from('ledger')
    .update({ 
      status: 'payout_initiated',
      payout_batch_id: payout.id,
      payout_initiated_at: new Date().toISOString(),
      stripe_payout_id: payout.id
    })
    .eq('source_account', payout.destination) // Connect account ID
    .in('status', ['completed', 'pending']);

  if (error) {
    console.error('Error updating ledger for payout:', error);
  }
}

/**
 * Handle payout completed (funds transferred to bank)
 */
async function handlePayoutPaid(payout) {
  console.log(`[Webhook] Payout paid: ${payout.id}`);
  
  // Update ledger entries for this payout batch
  const { error } = await supabase
    .from('ledger')
    .update({ 
      status: 'payout_completed',
      payout_completed_at: new Date().toISOString()
    })
    .eq('payout_batch_id', payout.id);

  if (error) {
    console.error('Error updating ledger for completed payout:', error);
  }
  
  // Emit event to Finance Agent
  await emitPayoutEvent(payout);
}

/**
 * Determine which revenue stream a payment belongs to
 * Based on metadata, client reference, or other identifiers
 */
function determineRevenueStream(paymentIntent) {
  // Check metadata first
  if (paymentIntent.metadata?.revenue_stream) {
    return paymentIntent.metadata.revenue_stream;
  }
  
  if (paymentIntent.metadata?.project_code) {
    return paymentIntent.metadata.project_code;
  }
  
  // Check description for keywords
  const description = (paymentIntent.description || '').toLowerCase();
  
  if (description.includes('galactic') || description.includes('bytes')) {
    return 'galactic_bytes';
  }
  if (description.includes('detailer') || description.includes('bot')) {
    return 'detailer_bot';
  }
  if (description.includes('lipi')) {
    return 'lipi_v2';
  }
  if (description.includes('protogrance') || description.includes('aromatic')) {
    return 'protogrance_aromatics';
  }
  if (description.includes('rezonate')) {
    return 'rezonate';
  }
  if (description.includes('waveformer') || description.includes('studio')) {
    return 'waveformer_studio';
  }
  
  // Default to galactic_bytes if can't determine
  console.warn(`[Webhook] Could not determine revenue stream for ${paymentIntent.id}, defaulting to galactic_bytes`);
  return 'galactic_bytes';
}

/**
 * Emit payment event to ProtoForge event bus
 */
async function emitPaymentEvent(ledgerEntry, revenueStream) {
  // This would integrate with the ProtoForge event bus
  console.log(`[Webhook] Emitting payment event for ${revenueStream}`);
  
  // Example event structure for ProtoForge integration
  const event = {
    type: 'REVENUE_RECEIVED',
    source: 'stripe_connect_webhook',
    target: 'finance_agent',
    priority: 'high',
    payload: {
      transaction_id: ledgerEntry.transaction_id,
      revenue_stream: revenueStream,
      amount_gross: ledgerEntry.amount_gross,
      net_amount: ledgerEntry.net_amount,
      platform_fee: ledgerEntry.platform_fee_amount,
      agent_fee: ledgerEntry.agent_fee_amount,
      source_account: ledgerEntry.source_account
    }
  };
  
  // In production, this would call the ProtoForge event bus
  console.log('[Webhook] Event emitted:', JSON.stringify(event, null, 2));
}

/**
 * Emit payout event to Finance Agent
 */
async function emitPayoutEvent(payout) {
  console.log(`[Webhook] Emitting payout event for ${payout.id}`);
  
  const event = {
    type: 'PAYOUT_COMPLETED',
    source: 'stripe_connect_webhook',
    target: 'finance_agent',
    priority: 'medium',
    payload: {
      payout_id: payout.id,
      amount: payout.amount / 100,
      destination: payout.destination,
      arrival_date: payout.arrival_date
    }
  };
  
  console.log('[Webhook] Payout event emitted:', JSON.stringify(event, null, 2));
}

// Export helper functions for testing
module.exports = {
  determineRevenueStream,
  REVENUE_STREAM_ACCOUNTS,
  FEE_STRUCTURE
};
