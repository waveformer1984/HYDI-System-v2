/**
 * Shared Stripe Connect ledger logic.
 *
 * Used by both api/stripe-connect-webhook.js (the Connect-specific webhook
 * endpoint) and workers/RevenueIngestionWorker.js (queued events arriving
 * via api/webhooks/stripe.js), so a payment_intent.succeeded event is
 * fee-split and ledgered the same way regardless of which endpoint Stripe
 * actually delivers it to.
 */

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
    `[Ledger] Cannot determine revenue stream for ${paymentIntent.id}, defaulting to galactic_bytes`
  );
  return 'galactic_bytes';
}

/**
 * Fee-splits a succeeded PaymentIntent and writes the ledger row.
 * Idempotent: a redelivered event (same paymentIntent.id) is recognized via
 * a pre-insert lookup, with the DB's unique index on
 * ledger.stripe_payment_intent_id as the authoritative guard against the
 * lookup-then-insert race between concurrent redeliveries.
 */
async function recordPaymentIntentSucceeded(paymentIntent, { supabase, stripe }) {
  const { data: existingEntry, error: lookupError } = await supabase
    .from('ledger')
    .select('transaction_id')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existingEntry) {
    console.log(
      `[Ledger] Duplicate delivery for ${paymentIntent.id}, ledger entry already exists: ${existingEntry.transaction_id}`
    );
    return existingEntry;
  }

  const revenueStream = determineRevenueStream(paymentIntent);
  const connectAccountId = REVENUE_STREAM_ACCOUNTS[revenueStream];

  if (!connectAccountId) {
    throw new Error(`Cannot route payment -- unknown revenue stream: ${revenueStream}`);
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
    `[Ledger] ${revenueStream} -- gross $${gross.toFixed(2)}, net $${net.toFixed(2)}`
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

  if (error) {
    // Unique-constraint race: a concurrent redelivery of the same event
    // inserted its row between our lookup above and this insert. The DB
    // constraint (see 20260714160000_ledger_stripe_payment_intent_unique.sql)
    // is the authoritative idempotency guard; treat this as already-processed
    // rather than a failure that would make the caller retry indefinitely.
    if (error.code === '23505') {
      console.log(`[Ledger] Concurrent duplicate insert for ${paymentIntent.id}, ignoring`);
      return null;
    }
    throw error;
  }

  console.log(`[Ledger] Ledger entry created: ${ledgerEntry.transaction_id}`);
  return ledgerEntry;
}

module.exports = {
  REVENUE_STREAM_ACCOUNTS,
  FEE_STRUCTURE,
  determineRevenueStream,
  recordPaymentIntentSucceeded,
};
