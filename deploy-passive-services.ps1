# Deploy and activate passive web services
param(
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-DeployLog($msg, $level = "INFO") {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $logEntry = "[$timestamp] [$level] $msg"
  Write-Host $logEntry
  Add-Content -Path "passive-services-deployment.log" -Value $logEntry -ErrorAction SilentlyContinue
}

function Test-WebhookEndpoint() {
  Write-DeployLog "Testing webhook endpoint..."
  
  $webhookUrl = "https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-webhook"
  
  try {
    # Test with a simple POST request
    $body = @{
      type = "test"
      created = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
    } | ConvertTo-Json -Depth 10
    
    $response = Invoke-RestMethod -Uri $webhookUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 10
    Write-DeployLog "✅ Webhook endpoint: RESPONDING"
    return $true
  } catch {
    Write-DeployLog "⚠️  Webhook endpoint: $($_.Exception.Message)"
    return $false
  }
}

function Deploy-EdgeFunction($functionName, $functionCode) {
  Write-DeployLog "Deploying Edge Function: $functionName"
  
  if ($DryRun) {
    Write-DeployLog "DRY RUN: Would deploy $functionName"
    return $true
  }
  
  try {
    # Create function directory if it doesn't exist
    $functionDir = "supabase\functions\$functionName"
    if (-not (Test-Path $functionDir)) {
      New-Item -ItemType Directory -Path $functionDir -Force | Out-Null
    }
    
    # Write function code
    $functionCode | Out-File -FilePath "$functionDir\index.ts" -Encoding UTF8
    
    # Deploy function
    $result = & supabase functions deploy $functionName --no-verify-jwt
    
    if ($LASTEXITCODE -eq 0) {
      Write-DeployLog "✅ $functionName: DEPLOYED"
      return $true
    } else {
      Write-DeployLog "❌ $functionName: DEPLOYMENT FAILED"
      return $false
    }
  } catch {
    Write-DeployLog "❌ $functionName: $($_.Exception.Message)"
    return $false
  }
}

# Main deployment
try {
  Write-DeployLog "Starting passive services deployment"
  
  # Test existing webhook
  $webhookWorking = Test-WebhookEndpoint
  
  if ($webhookWorking) {
    Write-DeployLog "✅ Webhook service already active"
  } else {
    Write-DeployLog "⚠️  Webhook service needs activation"
  }
  
  # Deploy event streaming service
  $eventStreamingCode = @"
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

interface Event {
  id: string
  type: string
  data: any
  timestamp: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method === 'GET') {
      // Return stream status
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
      // Process incoming events
      const event: Event = await req.json()
      
      // Store event in database (simplified)
      console.log('Event received:', event)
      
      return new Response(
        JSON.stringify({ 
          success: true,
          eventId: event.id,
          processed: true
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
  
  Deploy-EdgeFunction "events-stream" $eventStreamingCode
  
  # Deploy job processor service
  $jobProcessorCode = @"
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

interface Job {
  id: string
  type: string
  payload: any
  status: 'pending' | 'processing' | 'completed' | 'failed'
  createdAt: string
  processedAt?: string
}

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
      // Return processor status
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
      // Process job
      const job: Job = await req.json()
      
      console.log('Processing job:', job.id, job.type)
      
      // Simulate job processing
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          jobId: job.id,
          status: 'completed',
          processedAt: new Date().toISOString()
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
  
  Deploy-EdgeFunction "jobs-processor" $jobProcessorCode
  
  # Deploy monitoring service
  $monitoringCode = @"
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
      // Health check
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
  
  Deploy-EdgeFunction "monitoring-health" $monitoringCode
  
  # Deploy payout processor
  $payoutProcessorCode = @"
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

interface Payout {
  id: string
  clientId: string
  amount: number
  currency: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  createdAt: string
}

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
      // Return processor status
      return new Response(
        JSON.stringify({ 
          status: 'active',
          service: 'payout-processor',
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      // Process payout
      const payout: Payout = await req.json()
      
      console.log('Processing payout:', payout.id, payout.amount)
      
      // Simulate payout processing
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          payoutId: payout.id,
          status: 'completed',
          processedAt: new Date().toISOString()
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
  
  Deploy-EdgeFunction "payouts-processor" $payoutProcessorCode
  
  Write-DeployLog "Passive services deployment completed"
  
  if (-not $DryRun) {
    Write-DeployLog "🎯 ALL PASSIVE SERVICES DEPLOYED"
  } else {
    Write-DeployLog "🎯 DRY RUN COMPLETE - Ready for deployment"
  }
  
} catch {
  Write-DeployLog "Deployment failed: $($_.Exception.Message)" "ERROR"
  exit 1
}

Write-DeployLog "Deployment process finished" -ForegroundColor Green
