
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

  const limited = rateLimit(req, { name: 'content-management', windowMs: 60_000, max: 60 })
  if (limited) return limited

  try {
    if (req.method === 'GET') {
      return new Response(
        JSON.stringify({ 
          status: 'active',
          service: 'content-management',
          content: {
            articles: Math.floor(Math.random() * 50) + 10,
            videos: Math.floor(Math.random() * 20) + 5,
            social_posts: Math.floor(Math.random() * 100) + 20
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
      const content = await req.json()
      console.log('Creating content:', content.type)
      
      // Simulate content creation
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          contentId: `content_${Date.now()}`,
          status: 'published',
          platforms: content.platforms || ['website', 'social'],
          engagement: {
            views: Math.floor(Math.random() * 1000) + 100,
            shares: Math.floor(Math.random() * 50) + 5
          }
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
