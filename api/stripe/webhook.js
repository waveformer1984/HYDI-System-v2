import stripe from '../../lib/stripe/client';
import { getRawBody } from '../../lib/get-raw-body';

const ENDPOINT_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  if (!ENDPOINT_SECRET) {
    console.warn('[stripe/webhook] STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, ENDPOINT_SECRET);
  } catch (err) {
    console.error('[stripe/webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('[stripe/webhook] checkout completed:', session.id);
        // Persist to Supabase or trigger service provisioning here
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        console.log('[stripe/webhook] invoice paid:', invoice.id);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log('[stripe/webhook] invoice payment failed:', invoice.id);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        console.log(`[stripe/webhook] subscription ${event.type}:`, subscription.id);
        break;
      }
      case 'account.updated': {
        const account = event.data.object;
        console.log('[stripe/webhook] connect account updated:', account.id, 'charges_enabled:', account.charges_enabled);
        break;
      }
      default:
        console.log(`[stripe/webhook] unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error('[stripe/webhook] handler error:', err.message);
    return res.status(500).send('Handler error');
  }

  return res.status(200).json({ received: true });
}

export const config = {
  api: {
    bodyParser: false,
  },
};
