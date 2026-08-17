import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log('=== WEBHOOK DEBUG START ===');
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  if (req.method !== 'POST') {
    console.log('❌ Method not POST');
    return res.status(405).end();
  }

  const sig = req.headers['stripe-signature'];
  console.log('Stripe signature:', sig);
  console.log('Webhook secret:', process.env.STRIPE_WEBHOOK_SECRET ? 'SET' : 'MISSING');
  console.log('Supabase URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
  console.log('Supabase key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING');

  let event;
  try {
    console.log('Attempting signature verification...');
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('✅ Signature verification successful');
    console.log('Event type:', event.type);
    console.log('Event ID:', event.id);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Test database connection
  try {
    console.log('Testing Supabase connection...');
    const { data, error } = await supabase.from('webhook_events').select('count');
    if (error) {
      console.error('❌ Supabase connection error:', error);
      return res.status(500).json({ error: 'Database connection failed' });
    }
    console.log('✅ Supabase connection successful');
  } catch (error) {
    console.error('❌ Database test failed:', error);
    return res.status(500).json({ error: 'Database test failed' });
  }

  // Store webhook event
  try {
    console.log('Attempting to store webhook event...');
    const { error: insertError } = await supabase
      .from('webhook_events')
      .insert({
        stripe_event_id: event.id,
        event_type: event.type,
        payload: event.data.object,
        processed: false
      });

    if (insertError) {
      console.error('❌ Failed to store webhook event:', insertError);
      return res.status(500).json({ error: 'Failed to store webhook event', details: insertError });
    }
    console.log('✅ Webhook event stored successfully');
  } catch (error) {
    console.error('❌ Webhook storage failed:', error);
    return res.status(500).json({ error: 'Webhook storage failed', details: error });
  }

  console.log('=== WEBHOOK DEBUG END ===');
  res.status(200).json({ received: true, event_type: event.type, event_id: event.id });
}
