
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
          service: 'cache-service',
          cache: {
            hit_rate: `${(Math.random() * 30 + 70).toFixed(1)}%`,
            memory_usage: `${(Math.random() * 2 + 1).toFixed(1)}GB`,
            keys: Math.floor(Math.random() * 100000) + 10000,
            avg_response_time: `${(Math.random() * 10 + 1).toFixed(1)}ms`
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
      const cache = await req.json()
      console.log('Cache operation:', cache.operation)
      
      // Simulate cache operation
      await new Promise(resolve => setTimeout(resolve, 100))
      
      if (cache.operation === 'get') {
        return new Response(
          JSON.stringify({ 
            success: true,
            key: cache.key,
            found: Math.random() > 0.2,
            value: cache.found ? `cached_value_for_${cache.key}` : null,
            ttl: cache.found ? Math.floor(Math.random() * 3600) + 60 : null
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          }
        )
      } else if (cache.operation === 'set') {
        return new Response(
          JSON.stringify({ 
            success: true,
            key: cache.key,
            set: true,
            ttl: cache.ttl || 3600
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          }
        )
      }

      return new Response('Invalid operation', { status: 400 })
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
