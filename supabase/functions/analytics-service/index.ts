
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
          service: 'analytics-service',
          metrics: {
            page_views: Math.floor(Math.random() * 100000) + 10000,
            unique_visitors: Math.floor(Math.random() * 10000) + 1000,
            bounce_rate: `${(Math.random() * 30 + 20).toFixed(1)}%`,
            avg_session_duration: `${(Math.random() * 300 + 60).toFixed(0)}s`,
            conversion_rate: `${(Math.random() * 5 + 2).toFixed(2)}%`
          },
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const event = await req.json()
      console.log('Tracking analytics event:', event.type)
      
      // Simulate event tracking
      await new Promise(resolve => setTimeout(resolve, 500))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          eventId: `event_${Date.now()}`,
          type: event.type,
          tracked: true,
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
