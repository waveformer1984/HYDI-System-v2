import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { LedgerService } from '@/lib/ledger-service';

// Initialize Stripe with your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

// Webhook secret for signature verification
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    console.error('[WEBHOOK] No Stripe signature found');
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    // Verify webhook signature to ensure request is from Stripe
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    console.log('[WEBHOOK] Signature verified successfully');
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[WEBHOOK] Error processing event:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

/**
 * Handle successful checkout session completion
 * This is the main event for credit refills
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log('[WEBHOOK] Processing checkout session completed:', session.id);

  // Extract user ID from client_reference_id (set during checkout creation)
  const userId = session.client_reference_id;

  if (!userId) {
    console.error('[WEBHOOK] No client_reference_id found in session');
    throw new Error('Missing user ID in session');
  }

  // Extract amount and currency from session
  const amount = session.amount_total || 0;
  const currency = session.currency || 'usd';

  if (amount <= 0) {
    console.error('[WEBHOOK] Invalid amount:', amount);
    throw new Error('Invalid payment amount');
  }

  // Convert amount to credits (assuming $1 = 100 credits)
  const creditsToAdd = Math.floor((amount / 100) * 100);

  console.log(`[WEBHOOK] Adding ${creditsToAdd} credits to user ${userId}`);

  // Add credits to user's ledger
  const ledgerService = new LedgerService();
  const result = await ledgerService.addCredits(userId, creditsToAdd, {
    source: 'stripe_checkout',
    sessionId: session.id,
    amount: amount,
    currency: currency,
    timestamp: new Date().toISOString(),
    paymentStatus: session.payment_status,
    metadata: session.metadata
  });

  if (!result.success) {
    console.error('[WEBHOOK] Failed to add credits:', result.error);
    throw new Error(`Failed to add credits: ${result.error}`);
  }

  console.log(`[WEBHOOK] Successfully added ${creditsToAdd} credits to user ${userId}`);
  console.log(`[WEBHOOK] New balance: ${result.newBalance} credits`);

  // TODO: Send confirmation email to user
  // TODO: Update user's subscription status if applicable
}

/**
 * Handle successful payment intent
 * Alternative event for direct payments
 */
async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  console.log('[WEBHOOK] Processing payment intent succeeded:', paymentIntent.id);

  // Extract user ID from metadata
  const userId = paymentIntent.metadata?.userId;

  if (!userId) {
    console.error('[WEBHOOK] No userId found in payment intent metadata');
    throw new Error('Missing user ID in payment intent');
  }

  const amount = paymentIntent.amount || 0;
  const creditsToAdd = Math.floor((amount / 100) * 100);

  console.log(`[WEBHOOK] Adding ${creditsToAdd} credits to user ${userId} from payment intent`);

  const ledgerService = new LedgerService();
  const result = await ledgerService.addCredits(userId, creditsToAdd, {
    source: 'stripe_payment_intent',
    paymentIntentId: paymentIntent.id,
    amount: amount,
    currency: paymentIntent.currency || 'usd',
    timestamp: new Date().toISOString(),
    status: paymentIntent.status,
    metadata: paymentIntent.metadata
  });

  if (!result.success) {
    console.error('[WEBHOOK] Failed to add credits from payment intent:', result.error);
    throw new Error(`Failed to add credits: ${result.error}`);
  }

  console.log(`[WEBHOOK] Successfully added ${creditsToAdd} credits to user ${userId} from payment intent`);
}

/**
 * Handle successful invoice payment (for subscriptions)
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  console.log('[WEBHOOK] Processing invoice payment succeeded:', invoice.id);

  // Extract user ID from subscription metadata
  const inv = invoice as any;
  const userId = inv.subscription_details?.metadata?.userId ||
    invoice.customer_email?.split('@')[0]; // Fallback to email prefix

  if (!userId) {
    console.error('[WEBHOOK] No userId found in invoice');
    throw new Error('Missing user ID in invoice');
  }

  const amount = invoice.amount_paid || 0;
  const creditsToAdd = Math.floor((amount / 100) * 100);

  console.log(`[WEBHOOK] Adding ${creditsToAdd} credits to user ${userId} from invoice payment`);

  const ledgerService = new LedgerService();
  const result = await ledgerService.addCredits(userId, creditsToAdd, {
    source: 'stripe_subscription',
    invoiceId: invoice.id,
    subscriptionId: inv.subscription as string,
    amount: amount,
    currency: invoice.currency || 'usd',
    timestamp: new Date().toISOString(),
    status: invoice.status,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    metadata: invoice.metadata
  });

  if (!result.success) {
    console.error('[WEBHOOK] Failed to add credits from invoice:', result.error);
    throw new Error(`Failed to add credits: ${result.error}`);
  }

  console.log(`[WEBHOOK] Successfully added ${creditsToAdd} credits to user ${userId} from subscription`);
}

/**
 * Health check endpoint for webhook monitoring
 */
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    webhook: 'stripe',
    timestamp: new Date().toISOString(),
    configured: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)
  });
}
