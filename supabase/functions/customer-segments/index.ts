
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

  const limited = rateLimit(req, { name: 'customer-segments', windowMs: 60_000, max: 60 })
  if (limited) return limited

  try {
    if (req.method === 'GET') {
      return new Response(
        JSON.stringify({ 
          status: 'active',
          service: 'customer-segments',
          segments: [
            { name: 'enterprise', size: Math.floor(Math.random() * 100) + 20, value: '$50k+' },
            { name: 'mid-market', size: Math.floor(Math.random() * 200) + 50, value: '$10k-$50k' },
            { name: 'small-business', size: Math.floor(Math.random() * 500) + 100, value: '$1k-$10k' },
            { name: 'startup', size: Math.floor(Math.random() * 1000) + 200, value: '$0-$1k' }
          ],
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const customer = await req.json()
      console.log('Segmenting customer:', customer.email)
      
      // Simulate customer segmentation
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const segments = ['enterprise', 'mid-market', 'small-business', 'startup']
      const segment = segments[Math.floor(Math.random() * segments.length)]
      
      return new Response(
        JSON.stringify({ 
          success: true,
          customerId: customer.email,
          segment: segment,
          score: Math.floor(Math.random() * 100) + 1,
          recommendations: [`target_${segment}_campaign`, `personalize_content`]
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
