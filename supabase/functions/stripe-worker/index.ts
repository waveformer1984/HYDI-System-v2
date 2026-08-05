import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.21.0'
import { rateLimit } from '../_shared/security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Generous budget so real Stripe retry bursts / internal
  // billing-retry-worker calls are never affected -- defense-in-depth
  // against pure junk traffic, not the primary gate (signature
  // verification below is).
  const limited = rateLimit(req, { name: 'stripe-worker', windowMs: 60_000, max: 120 })
  if (limited) return limited

  // Hoisted out of the try so the catch below can hand the idempotency lease
  // back if processing fails after the event was claimed. Without that release,
  // the 500 we return makes Stripe retry, the retry re-claims, gets NULL because
  // this run's row is still there, and is answered `duplicate` -- so a transient
  // failure silently discards the event. Mirrors lib/webhook-idempotency.js on
  // the Node side (not importable here: different runtime).
  let claimedEventId: string | null = null
  let supabaseForCleanup: ReturnType<typeof createClient> | null = null

  try {
    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    supabaseForCleanup = supabase

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)

    // --- Signature inputs ---
    const sig = req.headers.get('stripe-signature');
    const webhookSecretRaw = Deno.env.get('STRIPE_WEBHOOK_SECRET_01') ?? Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const webhookSecret = webhookSecretRaw?.trim();

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
    claimedEventId = eventId

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

    // Past the point of no return: the event is handled, so the catch below
    // must not release the claim even if something further down throws.
    claimedEventId = null

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

    // Hand the lease back so Stripe's retry re-claims and actually reprocesses.
    if (claimedEventId && supabaseForCleanup) {
      const { error: releaseError } = await supabaseForCleanup
        .from('webhook_events')
        .delete()
        .eq('id', claimedEventId)

      if (releaseError) {
        console.error(
          `=== STUCK CLAIM ${claimedEventId}: release failed ===`,
          releaseError,
          '-- Stripe retries of this event will be answered as duplicates until the row is removed.'
        )
      } else {
        console.warn(`=== RELEASED CLAIM ${claimedEventId} -- Stripe retry will reprocess ===`)
      }
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
