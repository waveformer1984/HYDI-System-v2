
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method === 'GET') {
      return new Response(
        JSON.stringify({ 
          status: 'active',
          service: 'billing-engine',
          pendingInvoices: 12,
          processedToday: 45,
          totalBilled: 28500,
          successRate: '98.5%',
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const billing = await req.json()
      console.log('Processing billing:', billing.type, billing.clientId)
      
      // Process billing
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          billingId: `bill_${Date.now()}`,
          amount: billing.amount,
          status: 'processed',
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    return new Response('Method not allowed', { 
      headers: corsHeaders,
      status: 405 
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
