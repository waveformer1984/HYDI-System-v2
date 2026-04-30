
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
          service: 'email-marketing',
          campaigns: Math.floor(Math.random() * 10) + 5,
          subscribers: Math.floor(Math.random() * 1000) + 100,
          open_rate: `${(Math.random() * 30 + 20).toFixed(1)}%`,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const campaign = await req.json()
      console.log('Launching email campaign:', campaign.name)
      
      // Simulate email campaign
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          campaignId: `email_${Date.now()}`,
          sent: Math.floor(Math.random() * 500) + 100,
          opens: Math.floor(Math.random() * 100) + 20,
          clicks: Math.floor(Math.random() * 30) + 5,
          revenue: Math.floor(Math.random() * 5000) + 500
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
