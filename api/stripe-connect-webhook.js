/**
 * Stripe Connect Webhook Handler
 * Routes payments to correct sub-account and writes ledger entries
 */

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const {
  REVENUE_STREAM_ACCOUNTS,
  FEE_STRUCTURE,
  determineRevenueStream,
  recordPaymentIntentSucceeded,
} = require('../lib/billing/connect-ledger');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Connect Webhook] STRIPE_CONNECT_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Stripe requires the raw body — Next.js bodyParser must be disabled (see config export below)
  // req.body is a Buffer when bodyParser: false
  const rawBody = req.body;

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[Connect Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log(`[Connect Webhook] ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await recordPaymentIntentSucceeded(event.data.object, { supabase, stripe });
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
        console.log(`[Connect Webhook] Unhandled: ${event.type}`);
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[Connect Webhook] Processing error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handlePaymentIntentFailed(paymentIntent) {
  await supabase
    .from('ledger')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', paymentIntent.id);
}

async function handleChargeRefunded(charge) {
  await supabase
    .from('ledger')
    .update({
      status: 'refunded',
      metadata: {
        refund_amount: charge.amount_refunded / 100,
        refund_reason: charge.refunds?.data[0]?.reason || 'customer_request',
      },
    })
    .eq('stripe_charge_id', charge.id);
}

async function handlePayoutCreated(payout) {
  await supabase
    .from('ledger')
    .update({
      status: 'payout_initiated',
      payout_batch_id: payout.id,
      payout_initiated_at: new Date().toISOString(),
      stripe_payout_id: payout.id,
    })
    .eq('source_account', payout.destination)
    .in('status', ['completed', 'pending']);
}

async function handlePayoutPaid(payout) {
  await supabase
    .from('ledger')
    .update({
      status: 'payout_completed',
      payout_completed_at: new Date().toISOString(),
    })
    .eq('payout_batch_id', payout.id);
  console.log(`[Connect Webhook] Payout settled: ${payout.id} -- $${payout.amount / 100}`);
}

// Disable Next.js body parsing -- Stripe needs the raw Buffer for signature verification
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.REVENUE_STREAM_ACCOUNTS = REVENUE_STREAM_ACCOUNTS;
module.exports.FEE_STRUCTURE = FEE_STRUCTURE;
module.exports.determineRevenueStream = determineRevenueStream;
