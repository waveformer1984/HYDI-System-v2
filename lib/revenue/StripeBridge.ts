/**
 * HYDI Stripe Bridge
 *
 * Bridges the canonical revenue engine to Stripe.
 *
 * Responsibilities:
 *   - Create Checkout Sessions for offers (one-time and subscription)
 *   - Verify webhook signatures
 *   - Map Stripe events to canonical revenue ledger entries
 *   - Enforce idempotency via stripe_event_id
 *
 * Key principles:
 *   - A checkout redirect is NOT revenue.
 *   - A payment API request is NOT revenue.
 *   - Only a verified Stripe webhook event is revenue.
 *   - Never include payment_method_types (use dynamic payment methods).
 *   - Use restricted API keys (rk_) over secret keys (sk_) in production.
 *
 * Sandbox vs Live:
 *   - In sandbox/test mode, Stripe uses sk_test_ keys and test webhooks.
 *   - Live mode requires sk_live_ or rk_live_ keys and ALLOW_LIVE_STRIPE=true.
 *   - The bridge refuses to construct a live client without explicit opt-in.
 */

import Stripe from 'stripe';
import { RevenueLedger } from './RevenueLedger';
import { RevenueDatabase } from './RevenueDatabase';
import { getOfferCatalog } from './OfferCatalog';
import type { OfferId, CommercialOffer } from './types';

// ---------------------------------------------------------------------------
// Stripe Bridge
// ---------------------------------------------------------------------------

export class StripeBridge {
  private stripe: Stripe | null;
  private ledger: RevenueLedger;
  private mode: 'disabled' | 'test' | 'live';

  constructor(
    stripeSecretKey?: string,
    db?: RevenueDatabase,
  ) {
    this.ledger = new RevenueLedger(db);

    if (!stripeSecretKey && !process.env.STRIPE_SECRET_KEY) {
      this.stripe = null;
      this.mode = 'disabled';
      return;
    }

    const key = stripeSecretKey || process.env.STRIPE_SECRET_KEY!;

    // Safety guard: refuse ANY live keys (sk_live_ or rk_live_) without explicit opt-in
    const isLiveKey = key.startsWith('sk_live_') || key.startsWith('rk_live_');
    if (isLiveKey && process.env.ALLOW_LIVE_STRIPE !== 'true') {
      this.stripe = null;
      this.mode = 'disabled';
      console.error('StripeBridge: live key detected but ALLOW_LIVE_STRIPE is not "true" — refusing to construct live client');
      return;
    }

    this.stripe = new Stripe(key, {
      apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
      typescript: true,
    });

    this.mode = key.startsWith('sk_test_') || key.startsWith('rk_test_')
      ? 'test'
      : isLiveKey ? 'live' : 'live';
  }

  /**
   * Get the current Stripe mode.
   */
  getMode(): 'disabled' | 'test' | 'live' {
    return this.mode;
  }

  /**
   * Is Stripe configured and ready?
   */
  isConfigured(): boolean {
    return this.stripe !== null;
  }

  /**
   * Is Stripe in live (production) mode?
   */
  isLive(): boolean {
    return this.mode === 'live';
  }

  /**
   * Is Stripe in test mode?
   */
  isTest(): boolean {
    return this.mode === 'test';
  }

  /**
   * Production readiness check.
   * Returns a detailed report of what is configured and what is missing.
   * NEVER exposes secret values — only presence/mode indicators.
   */
  getProductionReadiness(): {
    ready: boolean;
    stripeMode: 'disabled' | 'test' | 'live';
    stripeKeyPresent: boolean;
    webhookSecretPresent: boolean;
    liveStripeExplicitlyAllowed: boolean;
    webhookProcessingEnabled: boolean;
    blockers: string[];
  } {
    const blockers: string[] = [];
    const key = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_01 || process.env.STRIPE_WEBHOOK_SECRET;
    const liveAllowed = process.env.ALLOW_LIVE_STRIPE === 'true';
    const webhookEnabled = process.env.WEBHOOK_PROCESSING_ENABLED === 'true';

    if (!key) {
      blockers.push('STRIPE_SECRET_KEY is not set');
    }
    if (!webhookSecret) {
      blockers.push('STRIPE_WEBHOOK_SECRET_01 (or STRIPE_WEBHOOK_SECRET) is not set — webhook signature verification will fail');
    }
    if (key && (key.startsWith('sk_live_') || key.startsWith('rk_live_')) && !liveAllowed) {
      blockers.push('Live Stripe key detected but ALLOW_LIVE_STRIPE is not "true"');
    }
    if (!webhookEnabled) {
      blockers.push('WEBHOOK_PROCESSING_ENABLED is not "true" — webhook handler will return "paused"');
    }
    if (this.mode === 'test') {
      blockers.push('Stripe is in TEST mode — not suitable for real customer payments');
    }
    if (this.mode === 'disabled') {
      blockers.push('Stripe is disabled — no key configured or live key blocked');
    }

    return {
      ready: blockers.length === 0,
      stripeMode: this.mode,
      stripeKeyPresent: !!key,
      webhookSecretPresent: !!webhookSecret,
      liveStripeExplicitlyAllowed: liveAllowed,
      webhookProcessingEnabled: webhookEnabled,
      blockers,
    };
  }

  // -----------------------------------------------------------------------
  // Checkout Session Creation
  // -----------------------------------------------------------------------

  /**
   * Create a Checkout Session for a one-time offer (setup fee).
   * Uses Checkout Sessions per Stripe best practices for one-time payments.
   */
  async createSetupCheckoutSession(input: {
    offerId: OfferId;
    customerEmail: string;
    customerName?: string;
    prospectId?: string;
    opportunityId?: string;
    successUrl: string;
    cancelUrl: string;
    authorizationId?: string;
  }): Promise<{ sessionId: string; url: string } | { error: string }> {
    if (!this.stripe) {
      return { error: 'Stripe is not configured — set STRIPE_SECRET_KEY to enable checkout' };
    }

    const offer = getOfferCatalog().get(input.offerId);
    if (!offer || offer.setupPrice === 0) {
      return { error: `Offer ${input.offerId} has no setup price` };
    }

    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: input.customerEmail,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: offer.name,
                description: offer.description,
              },
              unit_amount: offer.setupPrice,
            },
            quantity: 1,
          },
        ],
        metadata: {
          offer_id: input.offerId,
          prospect_id: input.prospectId || '',
          opportunity_id: input.opportunityId || '',
          customer_name: input.customerName || '',
          type: 'setup_fee',
          ...(input.authorizationId ? { hydi_authorization_id: input.authorizationId } : {}),
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });

      return { sessionId: session.id, url: session.url! };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { error: `Failed to create checkout session: ${msg}` };
    }
  }

  /**
   * Create a Checkout Session for a subscription offer.
   * Uses Checkout Sessions with subscription mode per Stripe best practices.
   *
   * Requires a Stripe Price ID to be configured for the offer.
   * Price IDs are set via environment variables or Stripe dashboard.
   */
  async createSubscriptionCheckoutSession(input: {
    offerId: OfferId;
    customerEmail: string;
    customerName?: string;
    prospectId?: string;
    opportunityId?: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ sessionId: string; url: string } | { error: string }> {
    if (!this.stripe) {
      return { error: 'Stripe is not configured — set STRIPE_SECRET_KEY to enable checkout' };
    }

    if (!input.priceId) {
      return { error: `No Stripe Price ID configured for offer ${input.offerId}` };
    }

    const offer = getOfferCatalog().get(input.offerId);
    if (!offer) {
      return { error: `Unknown offer: ${input.offerId}` };
    }

    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: input.customerEmail,
        line_items: [
          {
            price: input.priceId,
            quantity: 1,
          },
        ],
        metadata: {
          offer_id: input.offerId,
          prospect_id: input.prospectId || '',
          opportunity_id: input.opportunityId || '',
          customer_name: input.customerName || '',
          type: 'subscription',
        },
        subscription_data: {
          metadata: {
            offer_id: input.offerId,
            prospect_id: input.prospectId || '',
            opportunity_id: input.opportunityId || '',
          },
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });

      return { sessionId: session.id, url: session.url! };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { error: `Failed to create subscription checkout: ${msg}` };
    }
  }

  // -----------------------------------------------------------------------
  // Webhook Verification & Event Processing
  // -----------------------------------------------------------------------

  /**
   * Verify a Stripe webhook signature.
   * Returns the verified Stripe event or null if verification fails.
   *
   * This is the ONLY entry point for recording revenue.
   * No other path may write to the revenue ledger.
   */
  async verifyWebhook(
    payload: string | Buffer,
    signature: string,
    webhookSecret: string,
  ): Promise<Stripe.Event | null> {
    if (!this.stripe) {
      return null;
    }

    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      );
      return event;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Stripe webhook verification failed: ${msg}`);
      return null;
    }
  }

  /**
   * Process a verified Stripe event and record it in the revenue ledger.
   *
   * This is the canonical path from Stripe event → revenue ledger entry.
   * The event MUST be verified by verifyWebhook() first.
   *
   * Idempotency: if the stripe_event_id has already been processed,
   * returns the existing entry without creating a duplicate.
   */
  async processVerifiedEvent(
    event: Stripe.Event,
    attribution?: {
      prospectId?: string;
      opportunityId?: string;
      offerId?: OfferId;
    },
  ): Promise<{ recorded: boolean; eventType: string; amount: number }> {
    // Check idempotency
    const alreadyProcessed = await this.ledger.isEventProcessed(event.id);
    if (alreadyProcessed) {
      return { recorded: false, eventType: event.type, amount: 0 };
    }

    const mapping = this.mapStripeEventToLedger(event, attribution);
    if (!mapping) {
      // Unknown event type — log but don't fail
      return { recorded: false, eventType: event.type, amount: 0 };
    }

    const result = await this.ledger.recordEvent({
      eventType: mapping.eventType,
      source: 'stripe_webhook',
      stripeEventId: event.id,
      stripePaymentIntentId: mapping.stripePaymentIntentId,
      stripeChargeId: mapping.stripeChargeId,
      stripeInvoiceId: mapping.stripeInvoiceId,
      stripeSubscriptionId: mapping.stripeSubscriptionId,
      customerId: mapping.customerId,
      prospectId: mapping.prospectId,
      opportunityId: mapping.opportunityId,
      offerId: mapping.offerId,
      amountGross: mapping.amountGross,
      amountNet: mapping.amountNet,
      currency: mapping.currency,
      feeBreakdown: mapping.feeBreakdown,
      verified: true,
      metadata: mapping.metadata,
    });

    return {
      recorded: result.created,
      eventType: event.type,
      amount: mapping.amountGross,
    };
  }

  // -----------------------------------------------------------------------
  // Stripe Event Mapping
  // -----------------------------------------------------------------------

  private mapStripeEventToLedger(
    event: Stripe.Event,
    attribution?: {
      prospectId?: string;
      opportunityId?: string;
      offerId?: OfferId;
    },
  ): {
    eventType: import('./types').RevenueEventType;
    stripePaymentIntentId: string | null;
    stripeChargeId: string | null;
    stripeInvoiceId: string | null;
    stripeSubscriptionId: string | null;
    customerId: string;
    prospectId: string | null;
    opportunityId: string | null;
    offerId: OfferId | null;
    amountGross: number;
    amountNet: number;
    currency: string;
    feeBreakdown: { platformFee: number; stripeFee: number; otherFees: number };
    metadata: Record<string, unknown>;
  } | null {
    const data = event.data.object as unknown as Record<string, unknown>;

    // Extract customer ID from various event types
    const customerId = (data.customer as string) || '';

    // Extract metadata for attribution
    const metadata = (data.metadata as Record<string, unknown>) || {};
    const prospectId = attribution?.prospectId || (metadata.prospect_id as string) || null;
    const opportunityId = attribution?.opportunityId || (metadata.opportunity_id as string) || null;
    const offerId = attribution?.offerId || (metadata.offer_id as OfferId) || null;

    switch (event.type) {
      case 'checkout.session.completed': {
        const amountTotal = (data.amount_total as number) || 0;
        const sessionType = (metadata.type as string) || '';
        return {
          eventType: sessionType === 'setup_fee' ? 'setup_fee_collected' : 'payment_received',
          stripePaymentIntentId: (data.payment_intent as string) || null,
          stripeChargeId: null,
          stripeInvoiceId: null,
          stripeSubscriptionId: (data.subscription as string) || null,
          customerId,
          prospectId,
          opportunityId,
          offerId,
          amountGross: amountTotal,
          amountNet: amountTotal, // net = gross for direct payments (fees calculated separately)
          currency: (data.currency as string) || 'usd',
          feeBreakdown: { platformFee: 0, stripeFee: 0, otherFees: 0 },
          metadata: { session_id: data.id, mode: data.mode, ...metadata },
        };
      }

      case 'invoice.payment_succeeded': {
        const amountPaid = (data.amount_paid as number) || 0;
        const subscriptionId = (data.subscription as string) || null;
        return {
          eventType: subscriptionId ? 'subscription_renewed' : 'payment_received',
          stripePaymentIntentId: (data.payment_intent as string) || null,
          stripeChargeId: (data.charge as string) || null,
          stripeInvoiceId: (data.id as string) || null,
          stripeSubscriptionId: subscriptionId,
          customerId,
          prospectId,
          opportunityId,
          offerId,
          amountGross: amountPaid,
          amountNet: amountPaid,
          currency: (data.currency as string) || 'usd',
          feeBreakdown: { platformFee: 0, stripeFee: 0, otherFees: 0 },
          metadata: { invoice_id: data.id, subscription_id: subscriptionId, ...metadata },
        };
      }

      case 'invoice.payment_failed': {
        return {
          eventType: 'payment_failed',
          stripePaymentIntentId: (data.payment_intent as string) || null,
          stripeChargeId: null,
          stripeInvoiceId: (data.id as string) || null,
          stripeSubscriptionId: (data.subscription as string) || null,
          customerId,
          prospectId,
          opportunityId,
          offerId,
          amountGross: (data.amount_due as number) || 0,
          amountNet: 0,
          currency: (data.currency as string) || 'usd',
          feeBreakdown: { platformFee: 0, stripeFee: 0, otherFees: 0 },
          metadata: { invoice_id: data.id, ...metadata },
        };
      }

      case 'customer.subscription.created': {
        return {
          eventType: 'subscription_started',
          stripePaymentIntentId: null,
          stripeChargeId: null,
          stripeInvoiceId: null,
          stripeSubscriptionId: (data.id as string) || null,
          customerId,
          prospectId,
          opportunityId,
          offerId,
          amountGross: 0, // amount comes from invoice.payment_succeeded
          amountNet: 0,
          currency: (data.currency as string) || 'usd',
          feeBreakdown: { platformFee: 0, stripeFee: 0, otherFees: 0 },
          metadata: { subscription_id: data.id, status: data.status, ...metadata },
        };
      }

      case 'customer.subscription.deleted': {
        return {
          eventType: 'subscription_cancelled',
          stripePaymentIntentId: null,
          stripeChargeId: null,
          stripeInvoiceId: null,
          stripeSubscriptionId: (data.id as string) || null,
          customerId,
          prospectId,
          opportunityId,
          offerId,
          amountGross: 0,
          amountNet: 0,
          currency: (data.currency as string) || 'usd',
          feeBreakdown: { platformFee: 0, stripeFee: 0, otherFees: 0 },
          metadata: { subscription_id: data.id, canceled_at: data.canceled_at, ...metadata },
        };
      }

      case 'charge.refunded': {
        const amountRefunded = (data.amount_refunded as number) || 0;
        return {
          eventType: 'refund_issued',
          stripePaymentIntentId: (data.payment_intent as string) || null,
          stripeChargeId: (data.id as string) || null,
          stripeInvoiceId: null,
          stripeSubscriptionId: null,
          customerId,
          prospectId,
          opportunityId,
          offerId,
          amountGross: amountRefunded,
          amountNet: amountRefunded,
          currency: (data.currency as string) || 'usd',
          feeBreakdown: { platformFee: 0, stripeFee: 0, otherFees: 0 },
          metadata: { charge_id: data.id, ...metadata },
        };
      }

      default:
        // Unknown event type — not mapped to ledger
        return null;
    }
  }

  // -----------------------------------------------------------------------
  // Product/Price Management
  // -----------------------------------------------------------------------

  /**
   * Create or retrieve a Stripe Product for an offer.
   * This is needed before creating subscription checkout sessions.
   */
  async ensureProduct(offer: CommercialOffer): Promise<{ productId: string } | { error: string }> {
    if (!this.stripe) {
      return { error: 'Stripe is not configured' };
    }

    try {
      const product = await this.stripe.products.create({
        name: offer.name,
        description: offer.description,
        metadata: { offer_id: offer.offerId },
      });
      return { productId: product.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { error: `Failed to create product: ${msg}` };
    }
  }

  /**
   * Create a recurring Price for a subscription offer.
   */
  async createRecurringPrice(
    productId: string,
    offer: CommercialOffer,
  ): Promise<{ priceId: string } | { error: string }> {
    if (!this.stripe) {
      return { error: 'Stripe is not configured' };
    }

    try {
      const price = await this.stripe.prices.create({
        product: productId,
        unit_amount: offer.recurringPrice,
        currency: 'usd',
        recurring: {
          interval: offer.billingInterval === 'annual' ? 'year' : 'month',
        },
        metadata: { offer_id: offer.offerId },
      });
      return { priceId: price.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { error: `Failed to create price: ${msg}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Production Activation Requirements
// ---------------------------------------------------------------------------

export const PRODUCTION_ACTIVATION_REQUIREMENTS = {
  stripeAccount: 'A Stripe account (test or live) with API access',
  stripeSecretKey: 'STRIPE_SECRET_KEY environment variable (sk_test_ for sandbox, rk_ restricted key for production)',
  webhookSecret: 'STRIPE_WEBHOOK_SECRET environment variable (whsec_ from Stripe dashboard webhook endpoint)',
  allowLiveStripe: 'ALLOW_LIVE_STRIPE=true environment variable to enable live mode',
  priceIds: {
    ai_operations_monthly: 'STRIPE_PRICE_AI_OPS_MONTHLY — recurring price ID for AI Operations Monthly ($299/mo)',
    ai_website_monthly: 'STRIPE_PRICE_AI_WEBSITE_MONTHLY — recurring price ID for AI Website Monthly ($199/mo)',
    lead_gen_monthly: 'STRIPE_PRICE_LEAD_GEN_MONTHLY — recurring price ID for Lead Gen Monthly ($499/mo)',
  },
  webhookEndpoint: 'A Stripe webhook endpoint configured to POST to /api/webhooks/stripe with the events: checkout.session.completed, invoice.payment_succeeded, invoice.payment_failed, customer.subscription.created, customer.subscription.deleted, charge.refunded',
  customerFacingDomain: 'A customer-facing domain for checkout success/cancel URLs',
  notes: [
    'Use a restricted API key (rk_) in production, not a secret key (sk_).',
    'Never expose STRIPE_SECRET_KEY to the client/browser.',
    'Verify webhook signatures on every request — never trust unverified events.',
    'Record revenue ONLY from verified webhook events, never from API responses or redirects.',
    'Test mode uses sk_test_ keys and test webhook signing secrets.',
    'Live mode requires ALLOW_LIVE_STRIPE=true to prevent accidental live charges.',
  ],
};
