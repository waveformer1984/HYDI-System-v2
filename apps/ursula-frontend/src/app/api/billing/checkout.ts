import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

export interface CheckoutRequest {
  userId: string;
  amount: number; // in cents
  currency?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CheckoutRequest = await request.json();
    const { userId, amount, currency = 'usd', successUrl, cancelUrl } = body;

    // Validate input
    if (!userId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid userId or amount' },
        { status: 400 }
      );
    }

    // Define credit packages (optional validation)
    const validAmounts = [999, 1999, 4999, 9999]; // $9.99, $19.99, $49.99, $99.99
    if (!validAmounts.includes(amount)) {
      return NextResponse.json(
        { error: 'Invalid amount. Valid amounts: $9.99, $19.99, $49.99, $99.99' },
        { status: 400 }
      );
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: 'HYDI Credits',
              description: `${amount / 100} credits for Heidi AI operations`,
              images: ['https://your-domain.com/credits-image.png'],
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl || `${request.nextUrl.origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${request.nextUrl.origin}/billing/cancel`,
      client_reference_id: userId, // Pass user ID to webhook
      metadata: {
        userId,
        credits: (amount / 100).toString(),
        source: 'hydi_credits_checkout'
      },
      customer_email: undefined, // Let Stripe collect email
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
    });

    console.log(`[CHECKOUT] Created session ${session.id} for user ${userId}, amount $${amount / 100}`);

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('[CHECKOUT] Error creating session:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}

/**
 * Get checkout session details
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID required' },
      { status: 400 }
    );
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    return NextResponse.json({
      id: session.id,
      status: session.status,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      client_reference_id: session.client_reference_id,
      metadata: session.metadata,
    });
  } catch (error) {
    console.error('[CHECKOUT] Error retrieving session:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve session' },
      { status: 500 }
    );
  }
}
