import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { Redis } from '@upstash/redis';
import { ensureDeliveries, markOfferPaidFromWebhook } from '@/lib/revenue-engine/engine';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

// Redis for idempotency tracking
let redis: Redis | null = null;
try {
  redis = Redis.fromEnv();
} catch {
  console.warn('[WEBHOOK] Redis not available, using memory fallback for idempotency');
}

// Memory fallback for idempotency
const processedEvents = new Set<string>();

// Hard idempotency check - explicit database check
async function isEventProcessed(eventId: string): Promise<boolean> {
  try {
    if (redis) {
      const result = await redis.get(`webhook:event:${eventId}`);
      const processed = result !== null;
      console.log(`[WEBHOOK] Idempotency check for ${eventId}: ${processed}`);
      return processed;
    } else {
      const processed = processedEvents.has(eventId);
      console.log(`[WEBHOOK] Memory idempotency check for ${eventId}: ${processed}`);
      return processed;
    }
  } catch (error) {
    console.error('[WEBHOOK] Idempotency check failed:', error);
    // Fail safe - assume not processed to avoid missing events
    return false;
  }
}

// Mark event as processed - explicit database write
async function markEventProcessed(eventId: string): Promise<void> {
  try {
    if (redis) {
      await redis.set(`webhook:event:${eventId}`, JSON.stringify({
        processed: true,
        timestamp: new Date().toISOString(),
        event_id: eventId
      }), { ex: 86400 }); // 24 hours
      console.log(`[WEBHOOK] Marked event as processed: ${eventId}`);
    } else {
      processedEvents.add(eventId);
      console.log(`[WEBHOOK] Marked event as processed in memory: ${eventId}`);
    }
  } catch (error) {
    console.error('[WEBHOOK] Failed to mark event as processed:', error);
    // This is critical - if we can't mark it, we might process it twice
    throw new Error(`Failed to mark event ${eventId} as processed`);
  }
}

interface PaymentWebhookData {
  id: string;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  customer_details?: any;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  payment_intent?: string | Stripe.PaymentIntent | null;
  metadata?: Record<string, string> | null;
}

function customerToString(customer: PaymentWebhookData['customer']): string {
  if (typeof customer === 'string') {
    return customer;
  }
  if (customer && typeof customer === 'object' && 'id' in customer && typeof customer.id === 'string') {
    return customer.id;
  }
  return 'anonymous';
}

// Create task from payment event
async function createTaskFromPayment(event: Stripe.Event, paymentData: PaymentWebhookData): Promise<string> {
  const taskId = randomUUID();

  // Extract comprehensive payment context
  const paymentContext = {
    event_id: event.id,
    customer_id: customerToString(paymentData.customer),
    email: paymentData.customer_details?.email || 'unknown',
    product_id: paymentData.metadata?.product || 'unknown',
    product_name: paymentData.metadata?.product_name || paymentData.metadata?.product || 'Unknown Product',
    amount: paymentData.amount ? `$${(paymentData.amount / 100).toFixed(2)}` : 'Unknown amount',
    currency: paymentData.currency || 'usd',
    payment_intent_id:
      typeof paymentData.payment_intent === 'string' ? paymentData.payment_intent : paymentData.id,
    session_id: paymentData.id,
    status: paymentData.status || 'unknown',
    created_at: new Date().toISOString()
  };

  // Store payment context first
  try {
    if (redis) {
      await redis.set(`payment:${event.id}`, JSON.stringify(paymentContext));
    } else {
      console.log('[WEBHOOK] Redis not available, payment context not stored:', event.id);
    }
  } catch (error) {
    console.error('[WEBHOOK] Failed to store payment context:', error);
    // Continue anyway - task creation is more important
  }

  // Create task with full context
  const taskData = {
    id: taskId,
    intent: 'payment_received',
    message: `Payment received for ${paymentContext.product_name}: ${paymentContext.amount}`,
    user: paymentContext.customer_id,
    session_id: paymentContext.session_id,
    status: "queued",
    confidence: 1.0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source: 'stripe_webhook',
    event_id: event.id,
    payment_context: paymentContext
  };

  try {
    if (redis) {
      await redis.set(`task:${taskId}`, JSON.stringify(taskData));
    } else {
      console.log('[WEBHOOK] Redis not available, task not stored:', taskId);
    }
    console.log(`[WEBHOOK] Task created from payment: ${taskId}`);
    console.log(`[WEBHOOK] Payment context: Customer ${paymentContext.customer_id} paid ${paymentContext.amount} for ${paymentContext.product_name}`);
    return taskId;
  } catch (error) {
    console.error('[WEBHOOK] Failed to create task:', error);
    throw error;
  }
}

async function markRevenueOfferAsPaid(
  offerId: string | undefined,
  paymentReference: string
): Promise<{ updated: boolean; reason?: string }> {
  if (!offerId) {
    return { updated: false, reason: 'offer_id_missing' };
  }

  try {
    const updateResult = await markOfferPaidFromWebhook(offerId, paymentReference);
    if (updateResult.updated) {
      // Delivery generation is strictly gated behind paid offers.
      await ensureDeliveries();
      return { updated: true };
    }

    return { updated: false, reason: updateResult.reason };
  } catch (error) {
    console.error('[WEBHOOK] Failed to mark revenue offer as paid:', error);
    return { updated: false, reason: 'mark_paid_failed' };
  }
}

// Store failed events in dead letter queue for manual retry
async function storeDeadLetter(event: Stripe.Event, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const deadLetter = {
      event_id: event.id,
      event_type: event.type,
      event_data: event.data,
      error: message,
      timestamp: new Date().toISOString(),
      retry_count: 0,
      last_retry: null,
      status: 'failed'
    };

    if (redis) {
      await redis.set(`dead_letter:${event.id}`, JSON.stringify(deadLetter), { ex: 604800 }); // 7 days
      console.log(`[WEBHOOK] Stored in dead letter queue: ${event.id}`);
    } else {
      console.log(`[WEBHOOK] Dead letter not stored (Redis unavailable): ${event.id}`);
    }
  } catch (deadLetterError) {
    console.error('[WEBHOOK] Failed to store dead letter:', deadLetterError);
    // This is a critical failure - we can't even store the error
    // But we don't want to crash the webhook
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.text();
    const headersList = await headers();
    const signature = headersList.get('stripe-signature');
    const testBypass = headersList.get('x-test-bypass');

    console.log('[WEBHOOK] Request received');
    console.log('[WEBHOOK] Signature present:', !!signature);
    console.log('[WEBHOOK] Test bypass:', testBypass);

    // Allow test bypass for development
    if (!signature && testBypass !== 'true') {
      console.log('[WEBHOOK] Missing stripe-signature header');
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    let event: Stripe.Event;

    try {
      if (testBypass === 'true') {
        console.log('[WEBHOOK] Test mode - parsing event without signature verification');
        event = JSON.parse(body);
      } else {
        event = stripe.webhooks.constructEvent(body, signature!, process.env.STRIPE_WEBHOOK_SECRET!);
        console.log('[WEBHOOK] Event verified:', event.type);
        console.log('[WEBHOOK] Event ID:', event.id);
      }
    } catch (err) {
      console.log('[WEBHOOK] Event parsing failed:', err);
      return NextResponse.json(
        { error: 'Invalid event format' },
        { status: 400 }
      );
    }

    // Idempotency check
    if (await isEventProcessed(event.id)) {
      console.log('[WEBHOOK] Event already processed:', event.id);
      return NextResponse.json({ received: true, processed: true });
    }

    // Handle the event with failure recovery
    let processingResult = {
      success: false,
      taskId: null as string | null,
      error: null as string | null,
      revenueOfferPaid: false,
      revenueOfferReason: null as string | null,
    };

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          const checkoutSession = event.data.object as Stripe.Checkout.Session;
          console.log('[WEBHOOK] EVENT TYPE:', event.type);
          console.log('[WEBHOOK] SESSION ID:', checkoutSession.id);
          console.log('[WEBHOOK] CUSTOMER:', checkoutSession.customer);
          console.log('[WEBHOOK] AMOUNT:', checkoutSession.amount_total ? `$${(checkoutSession.amount_total / 100).toFixed(2)}` : 'No amount');
          console.log('[WEBHOOK] STATUS:', checkoutSession.status);

          // Create task from payment with full context
          const taskId = await createTaskFromPayment(event, {
            id: checkoutSession.id,
            customer: checkoutSession.customer,
            customer_details: checkoutSession.customer_details,
            amount: checkoutSession.amount_total,
            currency: checkoutSession.currency,
            status: checkoutSession.status,
            payment_intent: checkoutSession.payment_intent,
            metadata: checkoutSession.metadata
          });

          const paidFromCheckout = await markRevenueOfferAsPaid(
            checkoutSession.metadata?.offer_id,
            checkoutSession.id
          );

          processingResult = {
            success: true,
            taskId,
            error: null,
            revenueOfferPaid: paidFromCheckout.updated,
            revenueOfferReason: paidFromCheckout.reason || null,
          };
          console.log('[WEBHOOK] Checkout session processed successfully');
          break;

        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          console.log('[WEBHOOK] EVENT TYPE:', event.type);
          console.log('[WEBHOOK] PAYMENT INTENT ID:', paymentIntent.id);
          console.log('[WEBHOOK] CUSTOMER:', paymentIntent.customer);
          console.log('[WEBHOOK] AMOUNT:', paymentIntent.amount ? `$${(paymentIntent.amount / 100).toFixed(2)}` : 'No amount');
          console.log('[WEBHOOK] STATUS:', paymentIntent.status);

          // Create task from payment with full context
          const paymentTaskId = await createTaskFromPayment(event, {
            id: paymentIntent.id,
            customer: paymentIntent.customer,
            customer_details: paymentIntent.customer,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            status: paymentIntent.status,
            metadata: paymentIntent.metadata
          });

          const paidFromIntent = await markRevenueOfferAsPaid(
            paymentIntent.metadata?.offer_id,
            paymentIntent.id
          );

          processingResult = {
            success: true,
            taskId: paymentTaskId,
            error: null,
            revenueOfferPaid: paidFromIntent.updated,
            revenueOfferReason: paidFromIntent.reason || null,
          };
          console.log('[WEBHOOK] Payment intent processed successfully');
          break;

        default:
          console.log('[WEBHOOK] Unhandled event type:', event.type);
          processingResult = {
            success: true,
            taskId: null,
            error: null,
            revenueOfferPaid: false,
            revenueOfferReason: 'event_not_handled_for_revenue_offer',
          }; // Not an error, just unhandled
      }
    } catch (processingError) {
      console.error('[WEBHOOK] Processing failed:', processingError);
      processingResult = {
        success: false,
        taskId: null,
        error: processingError instanceof Error ? processingError.message : 'Unknown error',
        revenueOfferPaid: false,
        revenueOfferReason: 'processing_error',
      };

      // Store in dead letter queue for retry
      await storeDeadLetter(event, processingError);
    }

    // Always mark as processed (even failures) to prevent infinite retries
    await markEventProcessed(event.id);

    if (processingResult.success) {
      console.log('[WEBHOOK] Event processed successfully:', event.id);
      return NextResponse.json({
        received: true,
        processed: true,
        event_id: event.id,
        event_type: event.type,
        task_id: processingResult.taskId,
        revenue_offer_paid: processingResult.revenueOfferPaid,
        revenue_offer_reason: processingResult.revenueOfferReason
      });
    } else {
      console.log('[WEBHOOK] Event processed with errors:', event.id);
      return NextResponse.json({
        received: true,
        processed: true,
        event_id: event.id,
        event_type: event.type,
        error: processingResult.error,
        dead_letter_stored: true
      }, { status: 500 }); // Still return 500 to indicate processing failure
    }
  } catch (error) {
    console.error('[WEBHOOK] Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
