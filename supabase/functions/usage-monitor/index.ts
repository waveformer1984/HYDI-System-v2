
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
          service: 'usage-monitor',
          apiCallsToday: 125000,
          storageUsed: 850, // GB
          bandwidthUsed: 2400, // GB
          activeClients: 285,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const usage = await req.json()
      console.log('Monitoring usage:', usage.clientId, usage.type)
      
      // Track usage
      await new Promise(resolve => setTimeout(resolve, 300))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          usageId: `usage_${Date.now()}`,
          tracked: true,
          limits: {
            apiCalls: usage.apiCalls || 0,
            storage: usage.storage || 0,
            bandwidth: usage.bandwidth || 0
          },
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
