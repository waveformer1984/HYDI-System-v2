// Stripe webhook → customer job bridge
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

import { getJobManager } from './JobManager';
import { RevenueLedger } from './RevenueLedger';

/**
 * Process a verified Stripe checkout.session.completed event
 * for a customer job.
 *
 * @param input - The payment confirmation input
 * @param input.sessionId - Stripe checkout session ID
 * @param input.stripeEventId - Stripe event ID (for idempotency)
 * @param input.paymentIntentId - Stripe payment intent ID
 * @param input.amountTotal - Amount paid in cents
 * @param input.currency - Currency code
 * @returns { processed: boolean, jobId?: string, error?: string }
 */
export async function processJobPaymentConfirmation(input: {
  sessionId: string;
  stripeEventId: string;
  paymentIntentId: string | null;
  amountTotal: number;
  currency: string;
}): Promise<{ processed: boolean; jobId?: string; jobStatus?: string; paymentStatus?: string; ledgerEntryId?: string | null; idempotent?: boolean; error?: string }> {
  const {
    sessionId,
    stripeEventId,
    paymentIntentId,
    amountTotal,
    currency,
  } = input;

  const jobManager = getJobManager();

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
  const ledger = new RevenueLedger();
  let ledgerEntryId: string | null = null;
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
      offerId: job.product as any,
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
