// Customer job intake + checkout creation
// POST /api/revenue/jobs
//
// Creates a customer job record and a Stripe Checkout Session.
// The job starts as 'created' (unpaid). When the Stripe webhook
// confirms payment, the job transitions to 'queued'.
//
// This is the customer-facing entry point for the revenue loop.

import { getJobManager } from '../../../../lib/revenue/JobManager';
import { StripeBridge } from '../../../../lib/revenue/StripeBridge';
import { getOfferCatalog } from '../../../../lib/revenue/OfferCatalog';

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
