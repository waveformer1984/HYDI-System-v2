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
  galactic_bytes: process.env.STRIPE_ACCOUNT_GALACTIC_BYTES,
  detailer_bot: process.env.STRIPE_ACCOUNT_DETAILER_BOT,
  lipi_v2: process.env.STRIPE_ACCOUNT_LIPI_V2,
  protogrance_aromatics: process.env.STRIPE_ACCOUNT_PROTOGRANCE_AROMATICS,
  rezonate: process.env.STRIPE_ACCOUNT_REZONATE,
  waveformer_studio: process.env.STRIPE_ACCOUNT_WAVEFORMER_STUDIO,
};

// Fee structure
const FEE_STRUCTURE = {
  platform_fee_percent: 5.0,
  agent_fee_percent: 10.0,
  stripe_fee_percent: 2.9,
  stripe_fixed_fee: 0.3,
};

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[Connect Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log(`[Connect Webhook] ${event.type} (${event.id})`);

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
        console.log(`[Connect Webhook] Unhandled: ${event.type}`);
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[Connect Webhook] Processing error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handlePaymentIntentSucceeded(paymentIntent) {
  const revenueStream = determineRevenueStream(paymentIntent);
  const connectAccountId = REVENUE_STREAM_ACCOUNTS[revenueStream];

  if (!connectAccountId) {
    throw new Error(`Cannot route payment — unknown revenue stream: ${revenueStream}`);
  }

  const charge = paymentIntent.latest_charge
    ? await stripe.charges.retrieve(paymentIntent.latest_charge, {
        stripeAccount: connectAccountId,
      })
    : null;

  const gross = paymentIntent.amount / 100;
  const platformFee = (gross * FEE_STRUCTURE.platform_fee_percent) / 100;
  const agentFee = (gross * FEE_STRUCTURE.agent_fee_percent) / 100;
  const stripeFee =
    (gross * FEE_STRUCTURE.stripe_fee_percent) / 100 + FEE_STRUCTURE.stripe_fixed_fee;
  const net = gross - platformFee - agentFee - stripeFee;

  console.log(
    `[Connect Webhook] ${revenueStream} — gross $${gross.toFixed(2)}, net $${net.toFixed(2)}`
  );

  const { data: ledgerEntry, error } = await supabase
    .from('ledger')
    .insert({
      stripe_payment_intent_id: paymentIntent.id,
      stripe_charge_id: charge?.id || null,
      source_account: connectAccountId,
      revenue_stream: revenueStream,
      project_code: revenueStream,
      amount_gross: gross,
      platform_fee_amount: platformFee,
      agent_fee_amount: agentFee,
      stripe_fee_amount: stripeFee,
      net_amount: net,
      currency: paymentIntent.currency.toLowerCase(),
      platform_fee_percent: FEE_STRUCTURE.platform_fee_percent,
      agent_fee_percent: FEE_STRUCTURE.agent_fee_percent,
      stripe_fee_percent: FEE_STRUCTURE.stripe_fee_percent,
      stripe_fixed_fee: FEE_STRUCTURE.stripe_fixed_fee,
      status: 'completed',
      description: paymentIntent.description || `Payment for ${revenueStream}`,
      customer_email:
        paymentIntent.receipt_email || charge?.billing_details?.email || null,
      customer_name: charge?.billing_details?.name || null,
      metadata: {
        stripe_event: 'payment_intent.succeeded',
        shipping: paymentIntent.shipping || null,
      },
    })
    .select()
    .single();

  if (error) throw error;

  console.log(`[Connect Webhook] Ledger entry created: ${ledgerEntry.transaction_id}`);
  return ledgerEntry;
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
  console.log(`[Connect Webhook] Payout settled: ${payout.id} — $${payout.amount / 100}`);
}

function determineRevenueStream(paymentIntent) {
  if (paymentIntent.metadata?.revenue_stream) {
    return paymentIntent.metadata.revenue_stream;
  }
  if (paymentIntent.metadata?.project_code) {
    return paymentIntent.metadata.project_code;
  }

  const desc = (paymentIntent.description || '').toLowerCase();
  if (desc.includes('galactic') || desc.includes('bytes')) return 'galactic_bytes';
  if (desc.includes('detailer') || desc.includes('bot')) return 'detailer_bot';
  if (desc.includes('lipi')) return 'lipi_v2';
  if (desc.includes('protogrance') || desc.includes('aromatic')) return 'protogrance_aromatics';
  if (desc.includes('rezonate')) return 'rezonate';
  if (desc.includes('waveformer') || desc.includes('studio')) return 'waveformer_studio';

  console.warn(
    `[Connect Webhook] Cannot determine revenue stream for ${paymentIntent.id}, defaulting to galactic_bytes`
  );
  return 'galactic_bytes';
}

module.exports = handler;
module.exports.REVENUE_STREAM_ACCOUNTS = REVENUE_STREAM_ACCOUNTS;
module.exports.FEE_STRUCTURE = FEE_STRUCTURE;
module.exports.determineRevenueStream = determineRevenueStream;
