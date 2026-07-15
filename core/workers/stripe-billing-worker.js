// core/workers/stripe-billing-worker.js
//
// In-process worker for Stripe / billing events:
//   payment_intent.succeeded   → write ledger entry
//   checkout.session.completed → fulfill order, write ledger
//   invoice.paid               → record subscription payment
//   payment_intent.failed      → log failure, trigger retry
//
// Domains: stripe, payment, checkout, billing, invoice, subscription

'use strict';

const { createClient } = require('@supabase/supabase-js');

// Revenue stream → Stripe Connect sub-account mapping (mirrors .env)
const STREAM_ACCOUNTS = {
  galactic_bytes:         process.env.STRIPE_ACCOUNT_GALACTIC_BYTES,
  detailer_bot:           process.env.STRIPE_ACCOUNT_DETAILER_BOT,
  lipi_v2:                process.env.STRIPE_ACCOUNT_LIPI_V2,
  protogrance_aromatics:  process.env.STRIPE_ACCOUNT_PROTOGRANCE_AROMATICS,
  rezonate:               process.env.STRIPE_ACCOUNT_REZONATE,
  waveformer_studio:      process.env.STRIPE_ACCOUNT_WAVEFORMER_STUDIO
};

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}

async function writeLedgerEntry({ eventId, source, grossAmount, projectName, stripeEventType, metadata }) {
  const supabase = getSupabase();
  const platformFee   = Math.round(grossAmount * 0.05);   // 5%
  const agentFee      = Math.round(grossAmount * 0.10);   // 10%
  const stripeFee     = Math.round(grossAmount * 0.029) + 30; // 2.9% + $0.30
  const netAmount     = grossAmount - platformFee - agentFee - stripeFee;

  const { error } = await supabase.from('ledger').insert({
    source_event_id:   eventId,
    project_name:      projectName,
    gross_amount:      grossAmount,
    platform_fee:      platformFee,
    agent_fee:         agentFee,
    stripe_fee:        stripeFee,
    net_amount:        netAmount,
    payout_status:     'pending',
    stripe_event_type: stripeEventType,
    metadata:          metadata || {}
  });
  if (error) console.error('[stripe-billing] ledger insert error:', error.message);
  return !error;
}

async function execute(event) {
  const type      = event.type || event.event_type || '';
  const payload   = event.payload || {};
  const source    = event.source || '';
  const eventId   = event.event_id;

  console.log(`[stripe-billing] handling ${type} (event_id=${eventId})`);

  // ── payment_intent.succeeded ──────────────────────────────────────────────
  if (type.includes('payment_intent') && type.includes('succeeded')) {
    const amount      = payload.amount || payload.amount_received || 0;
    const project     = payload.metadata?.project_name || source;
    const written = await writeLedgerEntry({
      eventId, source, grossAmount: amount,
      projectName: project,
      stripeEventType: type,
      metadata: { stripe_payment_intent_id: payload.id }
    });
    return { handled: true, action: 'ledger_written', amount, project, ok: written };
  }

  // ── checkout.session.completed ────────────────────────────────────────────
  if (type.includes('checkout') && type.includes('completed')) {
    const amount  = payload.amount_total || 0;
    const project = payload.metadata?.project_name || source;
    const written = await writeLedgerEntry({
      eventId, source, grossAmount: amount,
      projectName: project,
      stripeEventType: type,
      metadata: { stripe_session_id: payload.id, customer: payload.customer }
    });
    return { handled: true, action: 'checkout_fulfilled', amount, project, ok: written };
  }

  // ── invoice.paid ──────────────────────────────────────────────────────────
  if (type.includes('invoice') && type.includes('paid')) {
    const amount  = payload.amount_paid || 0;
    const project = payload.metadata?.project_name || source;
    const written = await writeLedgerEntry({
      eventId, source, grossAmount: amount,
      projectName: project,
      stripeEventType: type,
      metadata: { stripe_invoice_id: payload.id, subscription: payload.subscription }
    });
    return { handled: true, action: 'invoice_recorded', amount, project, ok: written };
  }

  // ── payment failure / dispute ─────────────────────────────────────────────
  if (type.includes('failed') || type.includes('dispute') || type.includes('refund')) {
    console.warn(`[stripe-billing] payment failure: type=${type} payload=${JSON.stringify(payload).slice(0,200)}`);
    return { handled: true, action: 'failure_logged', type };
  }

  // Generic billing event
  console.log(`[stripe-billing] unhandled billing event type=${type}`);
  return { handled: true, action: 'billing_event_logged', type };
}

module.exports = {
  id: 'stripe-billing-worker',
  version: '1.0.0',
  domains: ['stripe', 'payment', 'checkout', 'billing', 'invoice', 'subscription'],
  execute,
  metadata: { description: 'Handles Stripe payment/billing events — writes ledger entries and fulfills orders' }
};
