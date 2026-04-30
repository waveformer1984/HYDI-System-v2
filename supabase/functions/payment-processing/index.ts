
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
          service: 'payment-processing',
          transactions: Math.floor(Math.random() * 10000) + 1000,
          revenue: Math.floor(Math.random() * 100000) + 10000,
          success_rate: `${(Math.random() * 5 + 95).toFixed(2)}%`,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const payment = await req.json()
      console.log('Processing payment:', payment.amount)
      
      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      const success = Math.random() > 0.05 // 95% success rate
      
      return new Response(
        JSON.stringify({ 
          success: success,
          paymentId: `payment_${Date.now()}`,
          amount: payment.amount,
          currency: payment.currency || 'USD',
          status: success ? 'completed' : 'failed',
          processedAt: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: success ? 200 : 400
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
