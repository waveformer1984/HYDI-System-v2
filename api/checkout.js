const Stripe = require('stripe');
const { rateLimit } = require('../lib/rate-limit');

// Lazy client: a missing STRIPE_SECRET_KEY must surface as a clean JSON
// error from the handler, not a cold-start crash (the Stripe SDK throws
// synchronously if the key is undefined). See api/health.js for the
// established pattern.
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

const PRICE_MAP = {
  starter:    process.env.STRIPE_HYDI_STARTER_PRICE_ID,
  pro:        process.env.STRIPE_HYDI_PRO_PRICE_ID,
  enterprise: process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID,
};

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!rateLimit(req, res, { name: 'checkout', windowMs: 10 * 60 * 1000, max: 10 })) {
    return;
  }

  // Parse request body properly
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const { tier, email, company } = JSON.parse(body);
      const priceId = PRICE_MAP[tier];
      
      if (!priceId) {
        return res.status(400).json({ error: 'Invalid tier' });
      }
      if (!email) {
        return res.status(400).json({ error: 'Email required' });
      }
      if (!company) {
        return res.status(400).json({ error: 'Company required' });
      }

      const session = await getStripe().checkout.sessions.create({
        mode:               'subscription',
        payment_method_types: ['card'],
        customer_email:     email,
        line_items:         [{ price: priceId, quantity: 1 }],
        metadata:           { tier, company },
        success_url:        `${req.headers.origin || 'http://localhost:3000'}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:         `${req.headers.origin || 'http://localhost:3000'}/signup?cancelled=true`,
      });

      return res.status(200).json({ url: session.url });
    } catch (error) {
      console.error('Checkout session creation failed:', error);
      return res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  req.on('error', (error) => {
    console.error('Request error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Request error' });
    }
  });
};
