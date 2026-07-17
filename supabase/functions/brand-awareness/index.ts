
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

  const limited = rateLimit(req, { name: 'brand-awareness', windowMs: 60_000, max: 60 })
  if (limited) return limited

  try {
    if (req.method === 'GET') {
      return new Response(
        JSON.stringify({ 
          status: 'active',
          service: 'brand-awareness',
          metrics: {
            brand_mentions: Math.floor(Math.random() * 1000) + 100,
            sentiment_score: `${(Math.random() * 2 + 3).toFixed(1)}/5`,
            reach: Math.floor(Math.random() * 1000000) + 100000,
            engagement: Math.floor(Math.random() * 10000) + 1000
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
      const campaign = await req.json()
      console.log('Launching brand awareness campaign:', campaign.type)
      
      // Simulate brand awareness campaign
      await new Promise(resolve => setTimeout(resolve, 2500))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          campaignId: `brand_${Date.now()}`,
          metrics: {
            impressions: Math.floor(Math.random() * 500000) + 50000,
            reach: Math.floor(Math.random() * 100000) + 10000,
            brand_lift: `${(Math.random() * 20 + 5).toFixed(1)}%`,
            cost_per_impression: `$0.044`
          },
          channels: ['social_media', 'content_marketing', 'pr', 'influencer']
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
