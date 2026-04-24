import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.21.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET_01')!

    // Get webhook signature
    const sig = req.headers.get('stripe-signature')
    if (!sig) {
      console.error('[WEBHOOK] Missing stripe-signature header')
      return new Response('Missing stripe-signature header', { status: 400 })
    }

    // Read body
    const body = await req.text()
    
    // Verify webhook signature
    let event
    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
    } catch (err) {
      console.error('[WEBHOOK] Signature verification failed:', err.message)
      return new Response(`Webhook Error: ${err.message}`, { status: 400 })
    }

    console.log(`[WEBHOOK] Processing event: ${event.type} (ID: ${event.id})`)

    // Idempotent event processing using RPC
    const { data: eventId, error: claimError } = await supabase.rpc('claim_webhook_event', {
      p_event_id: event.id,
      p_type: event.type
    })

    if (claimError) {
      console.error('[WEBHOOK] RPC claim error:', claimError)
      throw new Error(`Failed to claim event: ${claimError.message}`)
    }

    // Already processed
    if (!eventId) {
      console.log(`[WEBHOOK] Event ${event.id} already processed`)
      return new Response(JSON.stringify({ status: 'duplicate' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Process the event
    await processEvent(event, supabase, eventId)

    // Mark event as completed
    const { error: updateError } = await supabase
      .from('webhook_events')
      .update({ status: 'completed' })
      .eq('id', eventId)

    if (updateError) {
      console.error('[WEBHOOK] Failed to mark event completed:', updateError)
    }

    console.log(`[WEBHOOK] Successfully processed event: ${event.type}`)

    return new Response(JSON.stringify({ 
      received: true, 
      status: 'processed',
      event_id: event.id,
      event_type: event.type
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[WEBHOOK] Processing error:', error)
    
    // Try to mark event as failed if we have an eventId
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const supabase = createClient(supabaseUrl, supabaseServiceKey)
      
      // Extract event ID from error context or body
      const body = await req.text()
      const tempEvent = JSON.parse(body)
      
      await supabase
        .from('webhook_events')
        .update({ 
          status: 'failed',
          error: error.message
        })
        .eq('event_id', tempEvent.id)
        
    } catch (markError) {
      console.error('[WEBHOOK] Failed to mark event as failed:', markError)
    }
    
    return new Response(JSON.stringify({ 
      error: error.message,
      status: 'failed'
    }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

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
  console.log(`[WEBHOOK] Payment succeeded: ${invoice.id}`)
  
  // Add revenue tracking
  const { error } = await supabase
    .from('revenue_tracking')
    .insert({
      customer_id: invoice.customer, // This will need customer lookup
      stripe_event_id: invoice.id,
      amount: invoice.amount_paid / 100, // Convert from cents
      currency: invoice.currency.toLowerCase(),
      type: 'payment',
      status: 'completed'
    })
    
  if (error) {
    console.error('[WEBHOOK] Failed to track revenue:', error)
    throw error
  }
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
