
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
          service: 'lead-generation',
          leads: Math.floor(Math.random() * 100) + 20,
          qualified: Math.floor(Math.random() * 30) + 5,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const lead = await req.json()
      console.log('Processing new lead:', lead.email)
      
      // Simulate lead processing
      const score = Math.floor(Math.random() * 100) + 1
      const qualified = score > 70
      
      return new Response(
        JSON.stringify({ 
          success: true,
          leadId: `lead_${Date.now()}`,
          score: score,
          qualified: qualified,
          nextStep: qualified ? 'sales_contact' : 'nurture_campaign'
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
