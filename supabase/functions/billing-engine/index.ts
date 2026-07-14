import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.rpc('get_billing_engine_stats')

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }

      const stats = data?.[0] ?? {
        pending_count: 0,
        completed_today_count: 0,
        failed_today_count: 0,
        total_gross_completed: 0,
        total_net_completed: 0,
        success_rate: 100,
      }

      return new Response(
        JSON.stringify({
          status: 'active',
          service: 'billing-engine',
          pendingLedgerEntries: Number(stats.pending_count),
          completedToday: Number(stats.completed_today_count),
          failedToday: Number(stats.failed_today_count),
          totalGrossCompleted: Number(stats.total_gross_completed),
          totalNetCompleted: Number(stats.total_net_completed),
          successRate: `${stats.success_rate}%`,
          timestamp: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    if (req.method === 'POST') {
      // This is a read-only status lookup, not a billing-creation endpoint.
      // Ledger rows are only ever written from a verified Stripe webhook
      // signature (api/stripe-connect-webhook.js / RevenueIngestionWorker),
      // never from an arbitrary POST body -- accepting {clientId, amount}
      // here (as the original mock did) would let any caller holding a
      // valid JWT fabricate revenue unconnected to a real charge.
      const body = await req.json().catch(() => ({}))
      const { stripe_payment_intent_id, transaction_id } = body

      if (!stripe_payment_intent_id && !transaction_id) {
        return new Response(
          JSON.stringify({ error: 'stripe_payment_intent_id or transaction_id required' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      const query = supabase.from('ledger').select('*')
      const { data, error } = stripe_payment_intent_id
        ? await query.eq('stripe_payment_intent_id', stripe_payment_intent_id).maybeSingle()
        : await query.eq('transaction_id', transaction_id).maybeSingle()

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }

      if (!data) {
        return new Response(
          JSON.stringify({ error: 'not found' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        )
      }

      return new Response(
        JSON.stringify({ status: 'found', entry: data, timestamp: new Date().toISOString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    return new Response('Method not allowed', { headers: corsHeaders, status: 405 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
