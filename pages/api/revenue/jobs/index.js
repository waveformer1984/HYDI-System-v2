// Customer job intake + checkout creation
// POST /api/revenue/jobs
//
// Creates a customer job record and a Stripe Checkout Session.
// The job starts as 'created' (unpaid). When the Stripe webhook
// confirms payment, the job transitions to 'queued'.
//
// This is the customer-facing entry point for the revenue loop.
//
// LIVE MODE GUARD: If Stripe is in live mode (ALLOW_LIVE_STRIPE=true
// with a live key), this route checks for a valid pending
// LiveTransactionAuthorization matching the customer email. If none
// exists, the route refuses to create a live Checkout Session and
// returns 403. This prevents real customer traffic from riding along
// during a controlled qualification window — only the specifically
// authorized qualification transaction may proceed.

import { getJobManager } from '../../../../lib/revenue/JobManager';
import { StripeBridge } from '../../../../lib/revenue/StripeBridge';
import { getOfferCatalog } from '../../../../lib/revenue/OfferCatalog';
import { getStripeMode } from '../../../../lib/revenue/stripe-mode';
import { getLiveTransactionAuthorizationManager } from '../../../../lib/revenue/LiveTransactionAuthorization';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      customerEmail,
      customerName,
      product = 'protoforge_model_prep',
      requestText,
      requirements = {},
    } = req.body;

    // Validate required fields
    if (!customerEmail) return res.status(400).json({ error: 'customerEmail is required' });
    if (!requestText) return res.status(400).json({ error: 'requestText is required' });
    if (!customerEmail.includes('@')) return res.status(400).json({ error: 'Invalid email' });

    // Validate product exists
    const catalog = getOfferCatalog();
    const offer = catalog.get(product);
    if (!offer) return res.status(400).json({ error: `Unknown product: ${product}` });
    if (offer.setupPrice === 0) return res.status(400).json({ error: 'Product has no setup price' });

    // Create the job record
    const jobManager = getJobManager();
    const job = await jobManager.createJob({
      customerEmail,
      customerName,
      product,
      requestText,
      requirements,
      priceCents: offer.setupPrice,
      currency: 'usd',
    });

    // Create Stripe Checkout Session
    const stripe = new StripeBridge();
    if (!stripe.isConfigured()) {
      // Stripe not configured — return job without checkout URL
      // (useful for testing the job flow without Stripe)
      return res.status(201).json({
        jobId: job.jobId,
        priceCents: job.priceCents,
        currency: job.currency,
        checkoutUrl: null,
        message: 'Job created. Stripe not configured — use test mode to simulate payment.',
      });
    }

    // LIVE MODE GUARD: If Stripe is in live mode, require a valid pending
    // LiveTransactionAuthorization matching this customer. This prevents
    // real customer traffic from riding along during a controlled
    // qualification window. Only the specifically authorized qualification
    // transaction may proceed.
    const stripeMode = getStripeMode();
    if (stripeMode.mode === 'live') {
      const authManager = getLiveTransactionAuthorizationManager();
      const pendingAuth = authManager.getPending();
      if (!pendingAuth) {
        // No pending authorization — refuse live checkout
        return res.status(403).json({
          jobId: job.jobId,
          error: 'Live mode is active but no transaction authorization is pending. Live checkout is restricted to controlled qualification transactions.',
          liveModeGuarded: true,
        });
      }
      // Check that the customer matches the authorized customer
      if (pendingAuth.customer !== customerEmail) {
        return res.status(403).json({
          jobId: job.jobId,
          error: 'Live mode is active but this customer does not match the authorized qualification customer. Live checkout is restricted to the controlled qualification transaction.',
          liveModeGuarded: true,
        });
      }
      // Check that the amount does not exceed the authorized amount
      if (job.priceCents > pendingAuth.amountCents) {
        return res.status(403).json({
          jobId: job.jobId,
          error: 'Live mode is active but the job price exceeds the authorized amount. Live checkout is restricted to the controlled qualification transaction.',
          liveModeGuarded: true,
        });
      }
      // Check that the currency matches the authorized currency
      if (pendingAuth.currency && job.currency && pendingAuth.currency !== job.currency) {
        return res.status(403).json({
          jobId: job.jobId,
          error: 'Live mode is active but the job currency does not match the authorized currency. Live checkout is restricted to the controlled qualification transaction.',
          liveModeGuarded: true,
        });
      }
    }

    const origin = req.headers.origin || 'http://localhost:3000';
    const checkoutResult = await stripe.createSetupCheckoutSession({
      offerId: product,
      customerEmail,
      customerName,
      prospectId: null,
      opportunityId: null,
      successUrl: `${origin}/services/model-prep/success?jobId=${job.jobId}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/services/model-prep/cancel?jobId=${job.jobId}`,
    });

    if ('error' in checkoutResult) {
      return res.status(500).json({
        jobId: job.jobId,
        error: checkoutResult.error,
      });
    }

    // CONSUME THE AUTHORIZATION: Now that the checkout session has been
    // successfully created, consume the authorization to enforce single-use.
    // This prevents the same pending authorization from being used to create
    // multiple live checkout sessions within the 15-minute window.
    if (stripeMode.mode === 'live') {
      const authManager = getLiveTransactionAuthorizationManager();
      const pendingAuth = authManager.getPending();
      if (pendingAuth) {
        const consumeResult = authManager.consume(
          pendingAuth.authorizationId,
          job.jobId,
          job.priceCents,
          customerEmail,
          job.currency
        );
        if (!consumeResult.success) {
          // The authorization was consumed by a concurrent request or expired
          // between the pre-check and now. The checkout session was already
          // created, but we should log this for audit purposes.
          console.error('[Live Mode] Authorization consumption failed after checkout creation:', consumeResult.error);
        }
      }
    }

    // Link the checkout session to the job
    await jobManager.linkCheckoutSession(job.jobId, checkoutResult.sessionId);

    return res.status(201).json({
      jobId: job.jobId,
      priceCents: job.priceCents,
      currency: job.currency,
      checkoutUrl: checkoutResult.url,
      sessionId: checkoutResult.sessionId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
