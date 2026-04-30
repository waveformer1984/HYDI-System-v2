require('dotenv').config();
const http = require('http');
const Stripe = require('stripe');

// Startup validation
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey || !stripeKey.startsWith('sk_')) {
  console.error('❌ CRITICAL: Invalid or missing STRIPE_SECRET_KEY');
  process.exit(1);
}

console.log(`🔑 Stripe configured: ${stripeKey.substring(0, 7)}...${stripeKey.substring(stripeKey.length - 4)}`);

const stripe = new Stripe(stripeKey);

const PRICE_MAP = {
  starter:    process.env.STRIPE_HYDI_STARTER_PRICE_ID,
  pro:        process.env.STRIPE_HYDI_PRO_PRICE_ID,
  enterprise: process.env.STRIPE_HYDI_ENTERPRISE_PRICE_ID,
};

// Validate price IDs
Object.entries(PRICE_MAP).forEach(([tier, priceId]) => {
  if (!priceId || !priceId.startsWith('price_')) {
    console.error(`❌ CRITICAL: Invalid or missing price ID for ${tier}: ${priceId}`);
    process.exit(1);
  }
});

console.log('💰 Price IDs validated:', Object.keys(PRICE_MAP).join(', '));

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  if (req.method !== 'POST' || req.url !== '/api/checkout') {
    res.writeHead(404);
    return res.end();
  }

  // Parse request body
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const { tier, email, company } = JSON.parse(body);
      const priceId = PRICE_MAP[tier];
      
      if (!priceId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid tier' }));
      }
      if (!email) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Email required' }));
      }
      if (!company) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Company required' }));
      }

      const session = await stripe.checkout.sessions.create({
        mode:               'subscription',
        payment_method_types: ['card'],
        customer_email:     email,
        line_items:         [{ price: priceId, quantity: 1 }],
        metadata:           { 
          user_email: email,
          tier: tier,
          company: company
        },
        success_url:        `http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:         `http://localhost:3000/signup?cancelled=true`,
      });

      console.log(`🔗 Checkout session created: ${session.id.substring(0, 12)}... for ${email} (${tier})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ url: session.url }));
    } catch (error) {
      console.error('Checkout session creation failed:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Failed to create checkout session' }));
    }
  });
});

const PORT = 3001;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Simple Checkout Server running on http://127.0.0.1:${PORT}`);
  console.log(`💰 Checkout endpoint: http://127.0.0.1:${PORT}/api/checkout`);
});
