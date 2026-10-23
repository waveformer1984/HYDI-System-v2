import stripe from '../../lib/stripe/client';
import { getRawBody } from '../../lib/get-raw-body';

const PRICE_MAP = {
  starter: process.env.STRIPE_HYDI_STARTER_PRICE_ID,
  pro: process.env.STRIPE_HYDI_PRO_PRICE_ID,
  enterprise: process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID,
};

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    const raw = await getRawBody(req);
    body = JSON.parse(raw);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const {
    tier,
    price,
    mode = 'payment',
    email,
    customer,
    connected_account_id,
    application_fee_amount,
    application_fee_percent,
    success_url,
    cancel_url,
    metadata = {},
  } = body;

  const priceId = price || PRICE_MAP[tier];
  if (!priceId) {
    return res.status(400).json({ error: 'A valid price or tier is required' });
  }

  const line_items = [{ price: priceId, quantity: 1 }];

  const success = success_url || `${ORIGIN}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancel = cancel_url || `${ORIGIN}/?cancelled=true`;

  const sessionPayload = {
    mode,
    line_items,
    success_url: success,
    cancel_url: cancel,
    metadata: {
      ...metadata,
      hydi_integration: 'v0.9.0',
    },
    automatic_tax: { enabled: true },
  };

  if (email) {
    sessionPayload.customer_email = email;
  } else if (customer) {
    sessionPayload.customer = customer;
  }

  // Connect marketplace support — platform remains the merchant of record (destination charges)
  if (mode === 'payment' && connected_account_id) {
    sessionPayload.payment_intent_data = {
      transfer_data: { destination: connected_account_id },
      ...(application_fee_amount ? { application_fee_amount: Number(application_fee_amount) } : {}),
    };
  }

  if (mode === 'subscription' && connected_account_id) {
    sessionPayload.subscription_data = {
      transfer_data: { destination: connected_account_id },
      ...(application_fee_percent ? { application_fee_percent: Number(application_fee_percent) } : {}),
    };
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionPayload);
    return res.status(200).json({ url: session.url, session_id: session.id });
  } catch (error) {
    console.error('[stripe/checkout] session creation failed:', error.message);
    return res.status(500).json({ error: error.message });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
