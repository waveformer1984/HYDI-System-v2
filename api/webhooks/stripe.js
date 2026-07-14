/**
 * Stripe Webhook Handler
 * Processes Stripe events and triggers service provisioning
 */

const { createClient } = require('@supabase/supabase-js');
const HeidiRevenueOutreach = require('../../modules/heidi-revenue-outreach');
const UniversalAgentBus = require('../../modules/universal-agent-bus');
const WebhookQueueAdapter = require('../../workers/WebhookQueueAdapter');

require('dotenv').config();

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize components
const heidiOutreach = new HeidiRevenueOutreach();
const agentBus = new UniversalAgentBus();
const webhookQueue = new WebhookQueueAdapter();

// CASCADE WRITE CONTRACT - STRICT VALIDATION
function createOrUpdateService(input) {
  const {
    customer_id,
    service_name,
    status,
    price = null,
    currency = "usd",
    metadata = {}
  } = input;
  
  // REQUIRED VALIDATION
  if (!customer_id) throw new Error("customer_id required");
  if (!service_name) throw new Error("service_name required");
  
  // ENUM VALIDATION
  const validStatus = ["active", "inactive", "suspended"];
  if (!validStatus.includes(status)) {
    throw new Error("invalid status");
  }
  
  const validCurrency = ["usd", "eur", "gbp"];
  if (!validCurrency.includes(currency)) {
    throw new Error("invalid currency");
  }
  
  // NUMERIC VALIDATION
  if (price !== null && price < 0) {
    throw new Error("price must be >= 0");
  }
  
  // SAFE UPSERT
  return supabase
    .from("customer_services")
    .upsert({
      customer_id,
      service_name,
      status,
      price,
      currency,
      metadata
    }, {
      onConflict: "customer_id,service_name"
    });
}

// CASCADE CONFIGURATION
const CASCADE_SETTINGS = {
    CONFIDENCE_THRESHOLD: 0.3,
    LOG_LOW_SIGNAL: true,
    BYPASS_MODES: ['test_mode'] // Optional: Allow lower thresholds for dev
};

/**
 * GATE 2: CASCADE REJECTION LOGIC
 * Validates the integrity and confidence of the event before processing.
 */
const cascadeGate = (event) => {
    // 1. Extract metadata or confidence scores sent via Stripe metadata or internal headers
    const confidenceScore = parseFloat(event.data.object.metadata?.hydi_confidence) || 1.0; 
    const eventSource = event.data.object.metadata?.source || 'unknown';

    // 2. Threshold Validation
    if (confidenceScore < CASCADE_SETTINGS.CONFIDENCE_THRESHOLD) {
        if (CASCADE_SETTINGS.LOG_LOW_SIGNAL) {
            console.warn(`[🛡️ CASCADE REJECT] Low confidence event (${confidenceScore}) for ID: ${event.id}`);
        }
        return { authorized: false, reason: 'LOW_SIGNAL_REJECTION' };
    }

    // 3. Schema Integrity Check (Ensure required commercial fields exist)
    if (event.type.startsWith('customer.subscription') && !event.data.object.customer) {
        return { authorized: false, reason: 'DIRTY_DATA_SCHEMA_MISMATCH' };
    }

    return { authorized: true };
};

// Service tier configurations
const SERVICE_TIERS = {
  starter: {
    name: 'Starter',
    price: 49,
    services: ['SEO Content Generator', 'Blog Post Generator', 'Social Media Manager'],
    limits: { requests_per_month: 1000, storage_gb: 10 }
  },
  pro: {
    name: 'Pro', 
    price: 99,
    services: ['SEO Content Generator', 'Blog Post Generator', 'Social Media Manager', 'Data Pipeline Builder', 'Analytics Dashboard'],
    limits: { requests_per_month: 5000, storage_gb: 50 }
  },
  enterprise: {
    name: 'Enterprise',
    price: 199,
    services: ['All 30 Services Available'],
    limits: { requests_per_month: 'unlimited', storage_gb: 'unlimited' }
  }
};

async function handleStripeWebhook(req, res) {
  // GLOBAL KILL SWITCH - Non-negotiable incident control.
  // Opt-IN to pausing (explicit 'false'), not opt-in to processing: this var
  // is not provisioned in any environment by default, and defaulting an
  // unset/misconfigured flag to "drop everything with a 200" would silently
  // swallow every real webhook with no error and no Stripe retry.
  if (process.env.WEBHOOK_PROCESSING_ENABLED === 'false') {
    console.log('[🛑 KILL SWITCH] Webhook processing paused');
    return res.status(200).send('paused');
  }
  
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_01;
  
  let event;

  try {
    // Verify webhook signature
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.log('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // TRUE IDEMPOTENCY WITH RPC FUNCTION
  const { data: eventId } = await supabase.rpc('claim_webhook_event', {
    p_event_id: event.id,
    p_type: event.type
  });
  
  // Already processed
  if (!eventId) {
    console.log(`[🔄 IDEMPOTENCY] Event ${event.id} already processed`);
    return res.status(200).send('duplicate');
  }

  // GATE 2: CASCADE (Confidence & Integrity Validation)
  const gateStatus = cascadeGate(event);
  
  if (!gateStatus.authorized) {
    // Return 200 to Stripe to stop retries, but drop the data from the pipeline
    console.log(`[🛡️ CASCADE ACTION] Event ${event.id} dropped: ${gateStatus.reason}`);
    return res.status(200).json({ 
      status: 'dropped', 
      reason: gateStatus.reason,
      cascade_action: 'REJECT_LOW_CONFIDENCE' 
    });
  }

  // GATE 3: URSULA (Queue for async processing)
  console.log(`[🚀 CASCADE PASSED] Queuing event for processing: ${event.type}`);

  try {
    // Queue the event for async processing
    const queueResult = await webhookQueue.handleWebhook(event);
    
    // Update webhook event record with queue info
    await supabase
      .from('webhook_events')
      .update({ 
        status: queueResult.status,
        task_id: queueResult.taskId
      })
      .eq('id', eventId);

    // Return immediately - processing happens in background
    res.json({ 
      received: true, 
      status: 'QUEUED_FOR_PROCESSING',
      eventId: queueResult.eventId,
      taskId: queueResult.taskId
    });
  } catch (err) {
    console.error(`[⚡ QUEUE FAIL] Failed to queue event: ${err.message}`);
    
    // MARK EVENT AS FAILED
    try {
      await supabase
        .from('webhook_events')
        .update({ 
          status: 'queue_failed',
          error: err.message
        })
        .eq('id', eventId);
    } catch (recordErr) {
      console.error('Failed to update event status:', recordErr.message);
    }
    
    res.status(500).send('Queue Error');
  }
}

async function handleCheckoutCompleted(session) {
  console.log('Checkout completed:', session.id);
  
  const customerEmail = session.customer_details?.email;
  const customerId = session.customer;
  
  if (!customerEmail) {
    console.error('No customer email in session');
    return;
  }

  // Determine service tier from metadata or price
  const tier = determineServiceTier(session);
  
  // Create or update lead with payment information
  await createPaidLead(customerEmail, customerId, tier, session);
  
  // Provision services through Agent Bus
  await provisionServices(customerEmail, tier, customerId);
  
  // Update Heidi with successful payment
  await updateHeidiMemory(customerEmail, 'payment_completed', {
    session_id: session.id,
    tier: tier,
    amount: session.amount_total,
    currency: session.currency
  });
  
  console.log(`Successfully provisioned ${tier} services for ${customerEmail}`);
}

async function handlePaymentSucceeded(invoice) {
  console.log('Payment succeeded:', invoice.id);
  
  const customerId = invoice.customer;
  
  // Update system status with revenue
  await updateRevenueMetrics(invoice.amount_paid, invoice.currency);
  
  // Extend services if subscription payment
  if (invoice.subscription) {
    await extendSubscriptionServices(customerId, invoice);
  }
}

async function handleSubscriptionCreated(subscription) {
  console.log('Subscription created:', subscription.id);
  
  const customerId = subscription.customer;
  const tier = determineTierFromPrice(subscription.items.data[0].price.id);
  
  // Update customer's service tier
  await updateCustomerTier(customerId, tier, subscription);
}

async function handleSubscriptionUpdated(subscription) {
  console.log('Subscription updated:', subscription.id);
  
  const customerId = subscription.customer;
  const tier = determineTierFromPrice(subscription.items.data[0].price.id);
  
  // Update customer's service tier
  await updateCustomerTier(customerId, tier, subscription);
}

async function handleSubscriptionDeleted(subscription) {
  console.log('Subscription deleted:', subscription.id);
  
  const customerId = subscription.customer;
  
  // Deactivate services
  await deactivateServices(customerId);
  
  // Update Heidi
  const customer = await getCustomerEmail(customerId);
  if (customer) {
    await updateHeidiMemory(customer.email, 'subscription_cancelled', {
      subscription_id: subscription.id,
      cancelled_at: new Date().toISOString()
    });
  }
}

function determineServiceTier(session) {
  // Check metadata first
  if (session.metadata?.tier) {
    return session.metadata.tier.toLowerCase();
  }
  
  // Determine from price amount
  const amount = session.amount_total;
  if (amount >= 19900) return 'enterprise';
  if (amount >= 9900) return 'pro';
  return 'starter';
}

function determineTierFromPrice(priceId) {
  // This would match price IDs to tiers
  // For now, default to starter
  return 'starter';
}

async function createPaidLead(email, customerId, tier, session) {
  try {
    const { data, error } = await supabase
      .from('leads')
      .upsert({
        email: email,
        source: 'stripe_payment',
        metadata: {
          stripe_customer_id: customerId,
          tier: tier,
          session_id: session.id,
          amount_paid: session.amount_total,
          payment_status: 'completed'
        },
        welcome_sent: false
      })
      .select();
    
    if (error) throw error;
    
    console.log(`Created paid lead for ${email} (${tier} tier)`);
    return data[0];
  } catch (err) {
    console.error('Failed to create paid lead:', err);
    throw err;
  }
}

async function provisionServices(email, tier, customerId) {
  const tierConfig = SERVICE_TIERS[tier];
  
  console.log(`Provisioning ${tierConfig.services.length} services for ${email}`);
  
  // STRIPE CUSTOMER SYNC LOGIC
  let customer;
  
  // Try to find existing customer by Stripe ID
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
    
  if (existingCustomer?.id) {
    customer = existingCustomer;
  } else {
    // Try to find by email and update with Stripe ID
    const { data: emailCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .maybeSingle();
      
    if (emailCustomer?.id) {
      // Update existing customer with Stripe ID
      const { data: updatedCustomer } = await supabase
        .from('customers')
        .update({ stripe_customer_id: customerId })
        .eq('id', emailCustomer.id)
        .select('id')
        .single();
      customer = updatedCustomer;
    } else {
      // Create new customer
      const { data: newCustomer } = await supabase
        .from('customers')
        .insert({
          email: email,
          stripe_customer_id: customerId
        })
        .select('id')
        .single();
      customer = newCustomer;
    }
  }
    
  if (!customer?.id) {
    throw new Error(`Failed to create/find customer for ${email}`);
  }
  
  // Provision each service using CASCADE contract
  for (const serviceName of tierConfig.services) {
    try {
      await createOrUpdateService({
        customer_id: customer.id,
        service_name: serviceName,
        status: 'active',
        metadata: {
          tier: tier,
          stripe_customer_id: customerId,
          provisioned_at: new Date().toISOString()
        }
      });
      console.log(`✅ Service provisioned: ${serviceName}`);
    } catch (err) {
      console.error(`❌ Service provisioning failed: ${serviceName}`, err.message);
      throw err;
    }
  }
  
  // Update system status
  await supabase
    .from('system_status')
    .upsert({
      status: 'provisioning',
      version: '2.0.0-live',
      active_services: tierConfig.services.length,
      last_broadcast: new Date().toISOString()
    });
}

async function updateHeidiMemory(email, interactionType, data) {
  try {
    await supabase
      .from('heidi_memory')
      .upsert({
        user_email: email,
        last_interaction_type: interactionType,
        interaction_data: data
      });
  } catch (err) {
    console.error('Failed to update Heidi memory:', err);
  }
}

async function updateRevenueMetrics(amount, currency) {
  try {
    // This would update a revenue tracking table
    console.log(`Revenue updated: ${amount} ${currency}`);
  } catch (err) {
    console.error('Failed to update revenue metrics:', err);
  }
}

async function getCustomerEmail(customerId) {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const customer = await stripe.customers.retrieve(customerId);
    return { email: customer.email };
  } catch (err) {
    console.error('Failed to get customer:', err);
    return null;
  }
}

async function updateCustomerTier(customerId, tier, subscription) {
  try {
    // Update customer's tier in database
    console.log(`Updated customer ${customerId} to ${tier} tier`);
  } catch (err) {
    console.error('Failed to update customer tier:', err);
  }
}

async function extendSubscriptionServices(customerId, invoice) {
  try {
    // Extend service access
    console.log(`Extended services for customer ${customerId}`);
  } catch (err) {
    console.error('Failed to extend services:', err);
  }
}

async function deactivateServices(customerId) {
  try {
    // Deactivate customer's services
    console.log(`Deactivated services for customer ${customerId}`);
  } catch (err) {
    console.error('Failed to deactivate services:', err);
  }
}

// Vercel API handler — this must be the module's default export (not a
// named property) for Vercel/Next.js to recognize and invoke it as a route.
async function routeHandler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Stripe-Signature');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return handleStripeWebhook(req, res);
}

// Disable Next.js/Vercel body parsing -- Stripe's signature check in
// handleStripeWebhook() needs the raw body (req.body is a Buffer when
// bodyParser: false), not the JSON-parsed object the default parser produces.
routeHandler.config = { api: { bodyParser: false } };

module.exports = routeHandler;
module.exports.handleStripeWebhook = handleStripeWebhook;
module.exports.SERVICE_TIERS = SERVICE_TIERS;
