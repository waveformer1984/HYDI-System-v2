# Simple passive services deployment
$ErrorActionPreference = "Stop"

function Write-Log($msg) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] $msg"
  Add-Content -Path "services-deployment.log" -Value "[$timestamp] $msg" -ErrorAction SilentlyContinue
}

try {
  Write-Log "Starting passive services deployment"
  
  # Test webhook endpoint
  Write-Log "Testing webhook endpoint..."
  
  $webhookUrl = "https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-webhook"
  
  try {
    $body = @{
      type = "test"
      created = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
    } | ConvertTo-Json -Depth 10
    
    $response = Invoke-RestMethod -Uri $webhookUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 10
    Write-Log "Webhook endpoint: RESPONDING"
  } catch {
    Write-Log "Webhook endpoint: $($_.Exception.Message)"
  }
  
  # Create functions directory
  $functionsDir = "supabase\functions"
  if (-not (Test-Path $functionsDir)) {
    New-Item -ItemType Directory -Path $functionsDir -Force | Out-Null
    Write-Log "Created functions directory"
  }
  
  # Deploy event streaming function
  $eventDir = "$functionsDir\events-stream"
  if (-not (Test-Path $eventDir)) {
    New-Item -ItemType Directory -Path $eventDir -Force | Out-Null
  }
  
  $eventCode = @"
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
          service: 'event-streaming',
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
      console.log('Event received:', event)
      
      return new Response(
        JSON.stringify({ success: true, eventId: event.id }),
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
"@
  
  $eventCode | Out-File -FilePath "$eventDir\index.ts" -Encoding UTF8
  Write-Log "Created event streaming function"
  
  # Deploy job processor function
  $jobDir = "$functionsDir\jobs-processor"
  if (-not (Test-Path $jobDir)) {
    New-Item -ItemType Directory -Path $jobDir -Force | Out-Null
  }
  
  $jobCode = @"
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
          service: 'job-processor',
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const job = await req.json()
      console.log('Processing job:', job.id)
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          jobId: job.id,
          status: 'completed'
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
"@
  
  $jobCode | Out-File -FilePath "$jobDir\index.ts" -Encoding UTF8
  Write-Log "Created job processor function"
  
  # Deploy monitoring function
  $monitorDir = "$functionsDir\monitoring-health"
  if (-not (Test-Path $monitorDir)) {
    New-Item -ItemType Directory -Path $monitorDir -Force | Out-Null
  }
  
  $monitorCode = @"
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
      const health = {
        status: 'healthy',
        service: 'monitoring',
        timestamp: new Date().toISOString(),
        uptime: performance.now()
      }
      
      return new Response(
        JSON.stringify(health),
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
"@
  
  $monitorCode | Out-File -FilePath "$monitorDir\index.ts" -Encoding UTF8
  Write-Log "Created monitoring function"
  
  Write-Log "Passive services deployment completed"
  Write-Log "Run 'supabase functions deploy' to deploy the functions"
  
} catch {
  Write-Log "Deployment failed: $($_.Exception.Message)"
  exit 1
}

Write-Log "Deployment process finished"
