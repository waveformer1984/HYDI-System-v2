import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.21.0'

console.log("=== STRIPE WORKER V3 DEPLOYED ===")

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

serve(async (req) => {
  // CANARY LOG - FIRST LINE EXECUTION
  console.log("=== STRIPE WORKER V3 ACTIVE HIT ===", new Date().toISOString())
  console.log("=== REQUEST METHOD:", req.method)
  console.log("=== RAW ENTRY HIT - BEFORE ANY PROCESSING ===")
  
  // Initialize environment check
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET_01')
  console.log("=== SECRET LENGTH CHECK:", webhookSecret?.length || 0)
  console.log("=== SECRET EXISTS CHECK:", !!webhookSecret)
  
  console.log("=== REQUEST HEADERS:", Object.fromEntries(req.headers.entries()))

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log("=== CORS PREFLIGHT ===")
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log("=== INITIATING WEBHOOK PROCESSING ===")
    
    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    console.log("=== SUPABASE CLIENT CREATED ===")

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
    console.log("=== STRIPE CLIENT CREATED ===")
    console.log("=== USING SECRET FROM ENV CHECK ===")

    // --- Signature inputs ---
    const sig = req.headers.get('stripe-signature');
    const webhookSecretRaw = Deno.env.get('STRIPE_WEBHOOK_SECRET_01') ?? Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const webhookSecret = webhookSecretRaw?.trim();
    
    // Debug logging
    console.log("=== DEBUG VALUES ===");
    console.log("Signature header exists:", !!sig);
    console.log("Signature header value:", sig?.substring(0, 50) + "...");
    console.log("Webhook secret exists:", !!webhookSecret);
    console.log("Webhook secret length:", webhookSecret?.length || 0);
    console.log("Webhook secret starts with:", webhookSecret?.substring(0, 10) + "...");
    
    // Hard guards before constructEvent
    if (!sig) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reasonCode: "missing_signature_header"
        }),
        { 
          status: 400, 
          headers: { 
            "Content-Type": "application/json"
          } 
        }
      );
    }
    
    if (!webhookSecret) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reasonCode: "missing_webhook_secret"
        }),
        { 
          status: 500, 
          headers: { 
            "Content-Type": "application/json"
          } 
        }
      );
    }
    
    // CRITICAL: raw body only, read once
    const body = await req.text();
    console.log("=== RAW BODY LENGTH:", body.length);
    console.log("=== SIG LENGTH:", sig.length);
    console.log("=== SECRET LENGTH:", webhookSecret.length);
    console.log("=== SECRET START:", webhookSecret.substring(0, 10) + "...");
    console.log("=== RAW BODY START:", body.substring(0, 100));
    console.log("=== SIGNATURE HEADER:", sig);
    
    // --- Verify signature ---
    let event: Stripe.Event;
    try {
      // Use raw body as-is for signature verification
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
      console.log("=== SIGNATURE VERIFICATION SUCCEEDED ===", event.type, event.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("=== SIGNATURE VERIFICATION FAILED ===", msg);
      
      let reasonCode = "signature_verification_failed";
      if (msg.toLowerCase().includes("no signatures found")) reasonCode = "construct_event_failed";
      else if (msg.toLowerCase().includes("timestamp")) reasonCode = "timestamp_invalid";
      else if (msg.toLowerCase().includes("payload")) reasonCode = "payload_mismatch";
      
      return new Response(
        JSON.stringify({ 
          ok: false, 
          reasonCode 
        }),
        { 
          status: 400, 
          headers: { 
            "Content-Type": "application/json"
          } 
        }
      );
    }

    console.log(`=== PROCESSING EVENT: ${event.type} (ID: ${event.id}) ===`)

    // Idempotent event processing using RPC
    console.log("=== CLAIMING EVENT VIA RPC ===")
    const { data: eventId, error: claimError } = await supabase.rpc('claim_webhook_event', {
      p_event_id: event.id,
      p_type: event.type
    })

    console.log("=== RPC RESULT:", { eventId, claimError })

    if (claimError) {
      console.error('=== RPC CLAIM ERROR ===', claimError)
      throw new Error(`Failed to claim event: ${claimError.message}`)
    }

    // Already processed
    if (!eventId) {
      console.log(`=== EVENT ALREADY PROCESSED: ${event.id} ===`)
      return new Response(JSON.stringify({ status: 'duplicate' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log("=== EVENT CLAIMED, PROCESSING ===")
    
    // Process the event
    await processEvent(event, supabase, eventId)

    // Mark event as completed
    console.log("=== MARKING EVENT COMPLETED ===")
    const { error: updateError } = await supabase
      .from('webhook_events')
      .update({ status: 'completed' })
      .eq('id', eventId)

    if (updateError) {
      console.error('=== FAILED TO MARK EVENT COMPLETED ===', updateError)
    }

    console.log(`=== SUCCESSFULLY PROCESSED EVENT: ${event.type} ===`)

    return new Response(JSON.stringify({ 
      received: true, 
      status: 'processed',
      event_id: event.id,
      event_type: event.type
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('=== PROCESSING ERROR ===', error)
    
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
  console.log(`=== PROCESSING EVENT TYPE: ${event.type} ===`)
  
  // Simple processing for now
  switch (event.type) {
    case 'invoice.paid':
      console.log("=== HANDLING INVOICE.PAID ===")
      // Add basic processing
      break
    default:
      console.log(`=== UNHANDLED EVENT TYPE: ${event.type} ===`)
  }
}
