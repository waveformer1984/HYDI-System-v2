
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
    const url = new URL(req.url)
    const path = url.pathname
    
    // Route to appropriate service
    if (path.startsWith('/api/v1/users')) {
      return await forwardToService('user-management', req)
    } else if (path.startsWith('/api/v1/payments')) {
      return await forwardToService('payment-processing', req)
    } else if (path.startsWith('/api/v1/notifications')) {
      return await forwardToService('notification-service', req)
    } else if (path.startsWith('/api/v1/analytics')) {
      return await forwardToService('analytics-service', req)
    } else if (path.startsWith('/api/v1/files')) {
      return await forwardToService('file-storage', req)
    } else if (path.startsWith('/api/v1/search')) {
      return await forwardToService('search-service', req)
    } else if (path.startsWith('/api/v1/cache')) {
      return await forwardToService('cache-service', req)
    }
    
    // Default response
    return new Response(
      JSON.stringify({ 
        status: 'active',
        service: 'api-gateway',
        version: 'v1',
        endpoints: [
          '/api/v1/users',
          '/api/v1/payments',
          '/api/v1/notifications',
          '/api/v1/analytics',
          '/api/v1/files',
          '/api/v1/search',
          '/api/v1/cache'
        ],
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )
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

async function forwardToService(serviceName: string, req: Request) {
  // In a real implementation, this would forward to the appropriate service
  // For now, return a mock response
  return new Response(
    JSON.stringify({ 
      message: `Forwarded to ${serviceName}`,
      service: serviceName,
      timestamp: new Date().toISOString()
    }),
    { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    }
  )
}
