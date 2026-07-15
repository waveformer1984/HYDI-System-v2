/**
 * Stripe Connect Webhook Handler
 * Routes payments to correct sub-account and writes ledger entries
 */

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

// Lazy clients: missing env vars must surface as a clean JSON error from the
// handler, not a cold-start crash (both SDKs throw synchronously on a
// missing key/URL). See api/health.js for the established pattern.
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

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

  // Emergency kill switch — see ON_CALL_RUNBOOK.md / ROLLBACK_PLAYBOOK.md,
  // which document flipping WEBHOOK_PROCESSING_ENABLED=false to pause
  // webhook processing during an incident. This route never had that gate
  // before (the only prior implementation of it lived in the now-archived,
  // never-reachable api/webhooks/stripe.js — see
  // archive/legacy-stripe-webhook-implementations/README.md), so unlike
  // that original, this checks for an explicit "false" rather than
  // requiring an explicit "true": this route has always processed events
  // with no gate at all, and this sandbox cannot verify whether
  // WEBHOOK_PROCESSING_ENABLED is already configured in the real
  // deployment. Defaulting to "paused unless true" here risked silently
  // zeroing out ledger writes the moment this route became reachable.
  // 200 (not 4xx/5xx) so Stripe doesn't retry-storm a deliberate pause.
  if (process.env.WEBHOOK_PROCESSING_ENABLED === 'false') {
    console.log('[Connect Webhook] KILL SWITCH — processing paused (WEBHOOK_PROCESSING_ENABLED=false)');
    return res.status(200).json({ received: true, status: 'paused' });
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
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[Connect Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log(`[Connect Webhook] ${event.type} (${event.id})`);

  // Idempotency guard -- Stripe retries on timeout/non-2xx, which would otherwise
  // double-insert ledger rows. Shares the same claim_webhook_event RPC as the
  // subscription-tier webhook (supabase/functions/stripe-webhook/index.ts).
  const { data: claimedId } = await supabase.rpc('claim_webhook_event', {
    p_event_id: event.id,
    p_type: `connect:${event.type}`,
  });

  if (!claimedId) {
    console.log(`[Connect Webhook] Event ${event.id} already processed`);
    return res.status(200).json({ received: true, duplicate: true });
  }

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
    throw new Error(`Cannot route payment -- unknown revenue stream: ${revenueStream}`);
  }

  const charge = paymentIntent.latest_charge
    ? await getStripe().charges.retrieve(paymentIntent.latest_charge, {
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
    `[Connect Webhook] ${revenueStream} -- gross $${gross.toFixed(2)}, net $${net.toFixed(2)}`
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
  console.log(`[Connect Webhook] Payout settled: ${payout.id} -- $${payout.amount / 100}`);
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

// Disable Next.js body parsing -- Stripe needs the raw Buffer for signature verification
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.REVENUE_STREAM_ACCOUNTS = REVENUE_STREAM_ACCOUNTS;
module.exports.FEE_STRUCTURE = FEE_STRUCTURE;
module.exports.determineRevenueStream = determineRevenueStream;
