
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
          service: 'subscription-manager',
          activeSubscriptions: 285,
          newThisMonth: 12,
          churnedThisMonth: 3,
          mrr: 125000,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const subscription = await req.json()
      console.log('Managing subscription:', subscription.clientId, subscription.action)
      
      // Manage subscription
      await new Promise(resolve => setTimeout(resolve, 600))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          subscriptionId: `sub_${Date.now()}`,
          clientId: subscription.clientId,
          tier: subscription.tier,
          status: subscription.action === 'create' ? 'active' : 'updated',
          monthlyPrice: subscription.monthlyPrice || 0,
          features: subscription.features || [],
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
