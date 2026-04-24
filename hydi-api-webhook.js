import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_WEBHOOK_SECRET);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

async function handleCheckoutCompleted(session) {
  const { metadata, customer, subscription } = session;
  const { tier, company } = metadata;
  const email = session.customer_details?.email;

  if (!tier || !company || !email) {
    throw new Error('Missing required metadata');
  }

  // Generate unique client ID
  const clientId = `hydi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Sync subscription to Supabase
  const { data, error } = await supabase.rpc('sync_hydi_stripe_subscription', {
    p_client_id:        clientId,
    p_client_email:     email,
    p_client_company:   company,
    p_tier:             tier,
    p_stripe_customer:  customer,
    p_stripe_sub_id:    subscription
  });

  if (error) throw error;

  // Generate HYDI API token
  const token = Buffer.from(`${clientId}:${Date.now()}`).toString('base64');

  // Send welcome email (you would implement this)
  console.log(`Welcome email sent to ${email} with token: ${token}`);
  
  console.log(`HYDI subscription activated: ${clientId} (${tier})`);
}

async function handlePaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;
  console.log(`Payment succeeded for subscription: ${subscriptionId}`);
}

async function handleSubscriptionDeleted(subscription) {
  // Deactivate subscription in Supabase
  const { data, error } = await supabase
    .from('hydi_subscriptions')
    .update({ 
      status: 'deactivated',
      deactivated_at: new Date().toISOString()
    })
    .eq('stripe_sub_id', subscription.id);

  if (error) console.error('Failed to deactivate subscription:', error);
  else console.log(`Subscription deactivated: ${subscription.id}`);
}
