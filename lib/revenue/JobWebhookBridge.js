// Stripe webhook → customer job bridge (.js shim)
//
// This file is a CommonJS re-export shim for the TypeScript implementation
// in JobWebhookBridge.ts. The .ts version uses ESM imports that Next.js
// can resolve correctly. This .js version is kept for backward compatibility
// with callers that use require().
//
// When loaded by the Next.js dev server, require('./JobWebhookBridge')
// resolves to this .js file. We then try to load the .ts version using
// dynamic import(). If that fails (e.g., in plain Node without a TS
// loader), we fall back to a direct implementation using RevenueDatabase.

let processJobPaymentConfirmation;

// Try to use the TypeScript implementation via dynamic import.
// In Next.js dev mode, the TypeScript loader handles .ts files.
// We use a synchronous workaround: try requiring with .ts extension
// (works with ts-node/tsx loaders), then fall back to direct implementation.
try {
  // Next.js dev server with TypeScript support can handle this
  const tsModule = require('./JobWebhookBridge.ts');
  processJobPaymentConfirmation = tsModule.processJobPaymentConfirmation;
} catch {
  // Fallback: direct implementation using RevenueDatabase (pg)
  // This duplicates the logic from JobWebhookBridge.ts but uses
  // direct SQL queries instead of JobManager/RevenueLedger classes.
  processJobPaymentConfirmation = null; // Will be lazily initialized
}

// If the .ts require failed, create a direct implementation
if (!processJobPaymentConfirmation) {
  processJobPaymentConfirmation = async function processJobPaymentConfirmationDirect(input) {
    const {
      sessionId,
      stripeEventId,
      paymentIntentId,
      amountTotal,
      currency,
    } = input;

    // Use direct pg connection (same config as RevenueDatabase)
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.PG_HOST || '127.0.0.1',
      port: parseInt(process.env.PG_PORT || '54322', 10),
      database: process.env.PG_DATABASE || 'postgres',
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || 'postgres',
    });

    try {
      // Find the job by checkout session ID
      const { rows: jobRows } = await pool.query(
        'SELECT * FROM customer_jobs WHERE stripe_checkout_session_id = $1 LIMIT 1',
        [sessionId],
      );

      if (jobRows.length === 0) {
        return { processed: false };
      }

      const job = jobRows[0];

      // Idempotency: if already paid, skip
      if (job.payment_status === 'paid') {
        return { processed: true, jobId: job.job_id, idempotent: true };
      }

      // Verify amount matches
      if (amountTotal && amountTotal !== job.price_cents) {
        return {
          processed: false,
          jobId: job.job_id,
          error: `Amount mismatch: expected ${job.price_cents}¢, got ${amountTotal}¢`,
        };
      }

      // Record revenue ledger entry (idempotent via stripe_event_id)
      let ledgerEntryId = null;
      try {
        // Check if ledger entry already exists (idempotency)
        const { rows: existingLedger } = await pool.query(
          'SELECT * FROM revenue_ledger WHERE stripe_event_id = $1 LIMIT 1',
          [stripeEventId],
        );

        if (existingLedger.length > 0) {
          ledgerEntryId = existingLedger[0].ledger_entry_id || existingLedger[0].id;
        } else {
          const { rows: ledgerRows } = await pool.query(
            `INSERT INTO revenue_ledger (
              event_type, source, stripe_event_id, stripe_payment_intent_id,
              stripe_charge_id, stripe_invoice_id, stripe_subscription_id,
              customer_id, prospect_id, opportunity_id, offer_id,
              amount_gross, amount_net, currency, fee_breakdown,
              verified, verified_at, metadata, recorded_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            RETURNING *`,
            [
              'setup_fee_collected', 'stripe_webhook', stripeEventId, paymentIntentId,
              null, null, null,
              job.customer_email, null, null, job.product,
              amountTotal || job.price_cents, amountTotal || job.price_cents,
              currency || 'usd',
              JSON.stringify({ platformFee: 0, stripeFee: 0, otherFees: 0 }),
              true, new Date().toISOString(),
              JSON.stringify({ jobId: job.job_id, product: job.product, customerEmail: job.customer_email }),
              new Date().toISOString(),
            ],
          );
          ledgerEntryId = ledgerRows[0].ledger_entry_id || ledgerRows[0].id;
        }
      } catch (err) {
        console.error('Revenue ledger recording failed:', err instanceof Error ? err.message : err);
      }

      // Confirm payment and transition job to queued
      await pool.query(
        `UPDATE customer_jobs
         SET payment_status = 'paid', job_status = 'queued',
             stripe_event_id = $1, stripe_payment_intent_id = $2,
             ledger_entry_id = $3, paid_at = $4, updated_at = $4
         WHERE job_id = $5`,
        [stripeEventId, paymentIntentId, ledgerEntryId, new Date().toISOString(), job.job_id],
      );

      return {
        processed: true,
        jobId: job.job_id,
        jobStatus: 'queued',
        paymentStatus: 'paid',
        ledgerEntryId,
      };
    } finally {
      await pool.end();
    }
  };
}

module.exports = { processJobPaymentConfirmation };
