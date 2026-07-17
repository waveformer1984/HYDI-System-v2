
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { rateLimit } from '../_shared/security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const limited = rateLimit(req, { name: 'search-service', windowMs: 60_000, max: 60 })
  if (limited) return limited

  try {
    if (req.method === 'GET') {
      return new Response(
        JSON.stringify({ 
          status: 'active',
          service: 'search-service',
          index: {
            documents: Math.floor(Math.random() * 100000) + 10000,
            searches_today: Math.floor(Math.random() * 1000) + 100,
            avg_response_time: `${(Math.random() * 100 + 50).toFixed(0)}ms`
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
      const search = await req.json()
      console.log('Searching for:', search.query)
      
      // Simulate search
      await new Promise(resolve => setTimeout(resolve, 800))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          query: search.query,
          results: Math.floor(Math.random() * 50) + 5,
          took: Math.floor(Math.random() * 100) + 20,
          hits: Array.from({ length: Math.floor(Math.random() * 10) + 1 }, (_, i) => ({
            id: `doc_${i}`,
            title: `Result ${i + 1} for ${search.query}`,
            snippet: `This is a sample snippet for ${search.query}...`,
            score: Math.random() * 2 + 0.5
          }))
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
