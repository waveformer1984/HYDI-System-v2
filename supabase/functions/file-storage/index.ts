
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
          service: 'file-storage',
          storage: {
            total_files: Math.floor(Math.random() * 10000) + 1000,
            total_size: `${(Math.random() * 100 + 10).toFixed(1)}GB`,
            uploads_today: Math.floor(Math.random() * 100) + 10,
            bandwidth_used: `${(Math.random() * 1000 + 100).toFixed(1)}GB`
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
      const file = await req.json()
      console.log('Uploading file:', file.name)
      
      // Simulate file upload
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          fileId: `file_${Date.now()}`,
          name: file.name,
          size: file.size,
          url: `https://storage.example.com/files/file_${Date.now()}`,
          uploadedAt: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 201
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
