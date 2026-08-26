// Stripe webhook → customer job bridge (canonical CommonJS implementation)
//
// When a Stripe webhook confirms payment for a checkout session
// that has a linked customer job, this module:
//   1. Finds the job by stripe_checkout_session_id
//   2. Confirms payment (idempotent)
//   3. Transitions the job to 'queued' status
//   4. Records a revenue ledger entry
//
// This is called from the existing Stripe webhook handler after
// signature verification and idempotency check.
//
// IMPLEMENTATION NOTE:
// JobManager.ts and RevenueLedger.ts are TypeScript modules that use
// ESM imports. When bundled by Next.js/webpack, ESM modules are wrapped
// in an async boundary. A synchronous require() of these modules returns
// a module whose exports are not yet resolved. Therefore, we use dynamic
// import() inside the async function to load them at call time, which
// properly awaits the async boundary.
//
// There is NO raw-SQL fallback. If the real JobManager/RevenueLedger
// classes cannot be loaded, the bridge fails closed (returns an error).

let _getJobManager = null;
let _RevenueLedger = null;
let _loadAttempted = false;
let _loadError = null;

async function ensureModulesLoaded() {
  if (_loadAttempted) {
    if (_loadError) throw _loadError;
    return;
  }
  _loadAttempted = true;
  try {
    // Dynamic import() properly handles webpack's async boundary for ESM modules.
    // The .ts extension is needed so webpack resolves to the TypeScript module
    // rather than this .js file.
    const jobManagerMod = await import('./JobManager.ts');
    _getJobManager = jobManagerMod.getJobManager;

    const ledgerMod = await import('./RevenueLedger.ts');
    _RevenueLedger = ledgerMod.RevenueLedger;

    console.log('[JobWebhookBridge] Loaded JobManager and RevenueLedger via dynamic import()');
  } catch (err) {
    _loadError = err;
    const hint = err instanceof Error && err.message.includes('Cannot find module')
      ? ' (This module requires a TypeScript loader. In webpack/Next.js it works automatically. Outside webpack, run via tsx: `npx tsx script.ts`.)'
      : '';
    console.error('[JobWebhookBridge] Failed to load JobManager/RevenueLedger:', err instanceof Error ? err.message : err, hint);
    throw new Error(`JobWebhookBridge cannot load JobManager/RevenueLedger: ${err instanceof Error ? err.message : err}${hint}`);
  }
}

/**
 * Process a verified Stripe checkout.session.completed event
 * for a customer job.
 *
 * @param {object} input
 * @param {string} input.sessionId - Stripe checkout session ID
 * @param {string} input.stripeEventId - Stripe event ID (for idempotency)
 * @param {string|null} input.paymentIntentId - Stripe payment intent ID
 * @param {number} input.amountTotal - Amount paid in cents
 * @param {string} input.currency - Currency code
 * @returns {Promise<{processed: boolean, jobId?: string, error?: string}>}
 */
async function processJobPaymentConfirmation(input) {
  const {
    sessionId,
    stripeEventId,
    paymentIntentId,
    amountTotal,
    currency,
  } = input;

  // Load the real JobManager and RevenueLedger classes
  await ensureModulesLoaded();
  const jobManager = _getJobManager();

  // Find the job by checkout session ID
  const job = await jobManager.getJobBySessionId(sessionId);
  if (!job) {
    // Not a job-related checkout — could be a subscription or other product
    return { processed: false };
  }

  // Idempotency: if job is already paid, skip regardless of event ID
  // (A second webhook for the same checkout session should not create
  // a duplicate ledger entry, even if Stripe sends a different event ID.)
  if (job.paymentStatus === 'paid') {
    return { processed: true, jobId: job.jobId, idempotent: true };
  }

  // Verify amount matches
  if (amountTotal && amountTotal !== job.priceCents) {
    return {
      processed: false,
      jobId: job.jobId,
      error: `Amount mismatch: expected ${job.priceCents}¢, got ${amountTotal}¢`,
    };
  }

  // Record revenue ledger entry (immutable, idempotent via stripe_event_id)
  const ledger = new _RevenueLedger();
  let ledgerEntryId = null;
  try {
    const ledgerResult = await ledger.recordEvent({
      eventType: 'setup_fee_collected',
      source: 'stripe_webhook',
      stripeEventId,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: null,
      stripeInvoiceId: null,
      stripeSubscriptionId: null,
      customerId: job.customerEmail,
      prospectId: null,
      opportunityId: null,
      offerId: job.product,
      amountGross: amountTotal || job.priceCents,
      amountNet: amountTotal || job.priceCents,
      currency: currency || 'usd',
      feeBreakdown: { platformFee: 0, stripeFee: 0, otherFees: 0 },
      verified: true,
      metadata: {
        jobId: job.jobId,
        product: job.product,
        customerEmail: job.customerEmail,
      },
    });
    ledgerEntryId = ledgerResult.entry.ledgerEntryId;
  } catch (err) {
    // Ledger recording failed — but the payment is still confirmed.
    // Log the error but don't block job activation.
    console.error('Revenue ledger recording failed:', err instanceof Error ? err.message : err);
  }

  // Confirm payment and transition job to queued
  // This also records a 'payment_confirmed' event in customer_job_events
  const updatedJob = await jobManager.confirmPayment({
    jobId: job.jobId,
    stripeEventId,
    stripePaymentIntentId: paymentIntentId || undefined,
    ledgerEntryId: ledgerEntryId || undefined,
  });

  return {
    processed: true,
    jobId: updatedJob.jobId,
    jobStatus: updatedJob.jobStatus,
    paymentStatus: updatedJob.paymentStatus,
    ledgerEntryId,
  };
}

module.exports = { processJobPaymentConfirmation };
