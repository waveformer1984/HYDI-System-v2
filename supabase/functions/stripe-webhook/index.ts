import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import Stripe from "npm:stripe@14.21.0";
import { rateLimit } from "../_shared/security.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Generous budget so real Stripe retry bursts are never affected -- this
  // is defense-in-depth against pure junk traffic, not the primary gate
  // (Stripe signature verification below is).
  const limited = rateLimit(req, { name: "stripe-webhook", windowMs: 60_000, max: 120 });
  if (limited) return limited;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-04-10",
  });

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new Response(JSON.stringify({ error: "Missing stripe-signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // MUST read raw body before any parsing
  const body = await req.text();

  let event: Stripe.Event;
  try {
    // Use async signature verification for Deno/Web Crypto compatibility
    event = await (stripe.webhooks as any).constructEventAsync(
      body,
      sig,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (err: any) {
    console.error("[WEBHOOK] Signature verification failed:", err.message);
    return new Response(
      JSON.stringify({ error: "Invalid signature", details: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[WEBHOOK] Event: ${event.type} (${event.id})`);

  try {
    // Idempotent insert using keymaker_events table
    const { data: inserted, error: insertErr } = await supabase
      .from("keymaker_events")
      .insert({
        event_id: event.id,
        type: event.type,
        source: "stripe",
        severity: "info",
        payload: event as any,
        processed: false,
        occurred_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr) {
      if (insertErr.message?.includes("duplicate") || insertErr.code === "23505") {
        console.log(`[WEBHOOK] Duplicate event: ${event.id}`);
        return new Response(
          JSON.stringify({ ok: true, duplicate: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw insertErr;
    }

    const eventId = inserted.id;

    // Process the event
    await processEvent(event, supabase, eventId);

    // Mark completed
    await supabase
      .from("keymaker_events")
      .update({ processed: true })
      .eq("id", eventId);

    console.log(`[WEBHOOK] Completed: ${event.type}`);

    return new Response(
      JSON.stringify({
        received: true,
        status: "processed",
        event_id: event.id,
        event_type: event.type,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[WEBHOOK] Processing error:", err);
    return new Response(
      JSON.stringify({ error: err.message, status: "failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processEvent(event: any, supabase: any, eventId: string) {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object, supabase)
      break
    
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(event.data.object, supabase)
      break
    
    case 'customer.subscription.created':
      await handleSubscriptionCreated(event.data.object, supabase)
      break
    
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object, supabase)
      break
    
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object, supabase)
      break
    
    default:
      console.log(`[WEBHOOK] Unhandled event type: ${event.type}`)
  }
}

async function handleCheckoutCompleted(session: any, supabase: any) {
  console.log(`[WEBHOOK] Checkout completed: ${session.id}`)
  
  const customerEmail = session.customer_details?.email
  const customerId = session.customer
  
  if (!customerEmail) {
    throw new Error('No customer email in session')
  }

  // Find or create customer
  const customer = await findOrCreateCustomer(customerEmail, customerId, supabase)
  
  // Determine service tier
  const tier = determineServiceTier(session)
  
  // Provision services
  await provisionServices(customer.id, tier, customerId, supabase)
  
  console.log(`[WEBHOOK] Successfully provisioned ${tier} services for ${customerEmail}`)
}

async function handlePaymentSucceeded(invoice: any, supabase: any) {
  console.log(`[WEBHOOK] Payment succeeded: ${invoice.id}`);
  // Revenue tracking simplified - insert into keymaker_events
  await supabase.from("keymaker_events").insert({
    event_id: `payment_${invoice.id}`,
    type: "revenue_payment",
    source: "stripe_webhook",
    severity: "info",
    payload: { invoice_id: invoice.id, amount: invoice.amount_paid, currency: invoice.currency },
    processed: true,
    occurred_at: new Date().toISOString(),
  });
}

async function handleSubscriptionCreated(subscription: any, supabase: any) {
  console.log(`[WEBHOOK] Subscription created: ${subscription.id}`)
  // Handle subscription creation logic
}

async function handleSubscriptionUpdated(subscription: any, supabase: any) {
  console.log(`[WEBHOOK] Subscription updated: ${subscription.id}`)
  // Handle subscription update logic
}

async function handleSubscriptionDeleted(subscription: any, supabase: any) {
  console.log(`[WEBHOOK] Subscription deleted: ${subscription.id}`)
  
  // Deactivate services for this customer
  const { error } = await supabase
    .from('customer_services')
    .update({ status: 'suspended' })
    .eq('stripe_customer_id', subscription.customer)
    
  if (error) {
    console.error('[WEBHOOK] Failed to suspend services:', error)
    throw error
  }
}

async function findOrCreateCustomer(email: string, stripeCustomerId: string, supabase: any) {
  // Try to find existing customer by Stripe ID
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle()
    
  if (existingCustomer?.id) {
    return existingCustomer
  }
  
  // Try to find by email and update with Stripe ID
  const { data: emailCustomer } = await supabase
    .from('customers')
    .select('id')
    .eq('email', email)
    .maybeSingle()
    
  if (emailCustomer?.id) {
    // Update existing customer with Stripe ID
    const { data: updatedCustomer } = await supabase
      .from('customers')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('id', emailCustomer.id)
      .select('id')
      .single()
    return updatedCustomer
  }
  
  // Create new customer
  const { data: newCustomer } = await supabase
    .from('customers')
    .insert({
      email: email,
      stripe_customer_id: stripeCustomerId
    })
    .select('id')
    .single()
    
  if (!newCustomer) {
    throw new Error(`Failed to create customer for ${email}`)
  }
  
  return newCustomer
}

function determineServiceTier(session: any): string {
  // Check metadata first
  if (session.metadata?.tier) {
    return session.metadata.tier.toLowerCase()
  }
  
  // Determine from price amount
  const amount = session.amount_total
  if (amount >= 19900) return 'enterprise'
  if (amount >= 9900) return 'pro'
  return 'starter'
}

async function provisionServices(customerId: string, tier: string, stripeCustomerId: string, supabase: any) {
  const tierConfig = {
    starter: ['basic_support', 'api_access'],
    pro: ['priority_support', 'api_access', 'advanced_analytics'],
    enterprise: ['dedicated_support', 'api_access', 'advanced_analytics', 'custom_integrations']
  }
  
  const services = tierConfig[tier] || tierConfig.starter
  
  console.log(`[WEBHOOK] Provisioning ${services.length} services for tier: ${tier}`)
  
  for (const serviceName of services) {
    const { error } = await supabase
      .from('customer_services')
      .upsert({
        customer_id: customerId,
        service_name: serviceName,
        status: 'active',
        stripe_customer_id: stripeCustomerId,
        metadata: {
          tier: tier,
          provisioned_at: new Date().toISOString()
        }
      })
      
    if (error) {
      console.error(`[WEBHOOK] Failed to provision service ${serviceName}:`, error)
      throw error
    }
    
    console.log(`[WEBHOOK] Service provisioned: ${serviceName}`)
  }
}
