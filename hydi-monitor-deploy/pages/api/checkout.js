import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_MAP = {
  starter:    process.env.STRIPE_HYDI_STARTER_PRICE_ID,
  pro:        process.env.STRIPE_HYDI_PRO_PRICE_ID,
  enterprise: process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { tier, email, company } = req.body;
  const priceId = PRICE_MAP[tier];
  
  if (!priceId) return res.status(400).json({ error: 'Invalid tier' });
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode:               'subscription',
      payment_method_types: ['card'],
      customer_email:     email,
      line_items:         [{ price: priceId, quantity: 1 }],
      metadata:           { tier, company: company || '' },
      success_url:        `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:         `${req.headers.origin}/?cancelled=true`,
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Checkout session creation failed:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
