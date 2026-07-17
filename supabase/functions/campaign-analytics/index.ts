
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

  const limited = rateLimit(req, { name: 'campaign-analytics', windowMs: 60_000, max: 60 })
  if (limited) return limited

  try {
    if (req.method === 'GET') {
      return new Response(
        JSON.stringify({ 
          status: 'active',
          service: 'campaign-analytics',
          metrics: {
            total_campaigns: Math.floor(Math.random() * 20) + 5,
            active_campaigns: Math.floor(Math.random() * 5) + 1,
            total_spend: Math.floor(Math.random() * 50000) + 10000,
            total_revenue: Math.floor(Math.random() * 100000) + 20000,
            roi: `${(Math.random() * 3 + 1).toFixed(2)}x`,
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
      const analysis = await req.json()
      console.log('Analyzing campaign:', analysis.campaignId)
      
      // Simulate campaign analysis
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          campaignId: analysis.campaignId,
          performance: {
            impressions: Math.floor(Math.random() * 100000) + 10000,
            clicks: Math.floor(Math.random() * 2000) + 200,
            conversions: Math.floor(Math.random() * 100) + 10,
            cost_per_acquisition: Math.floor(Math.random() * 100) + 20,
            return_on_ad_spend: `${(Math.random() * 4 + 0.5).toFixed(2)}x`
          },
          recommendations: [
            'Increase budget for high-performing channels',
            'Optimize ad creatives for better CTR',
            'A/B test landing page variations'
          ]
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
