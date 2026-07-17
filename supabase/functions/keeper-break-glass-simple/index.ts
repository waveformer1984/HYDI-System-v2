import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { rateLimit } from '../_shared/security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BreakGlassRequest {
  level: number
  ttl_minutes: number
  reason: string
  requested_by?: string
}

interface BreakGlassResponse {
  success: boolean
  message: string
  circuit_state?: {
    level: number
    expires_at: string
    reason: string
    set_by: string
  }
  audit_id?: string
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Break-glass overrides a safety circuit -- rate limit brute-force /
    // flood attempts against it regardless of the auth outcome below.
    const limited = rateLimit(req, { name: 'keeper-break-glass-simple', windowMs: 60_000, max: 10 })
    if (limited) return limited

    // Verify break-glass token (Supabase handles JWT auth automatically)
    const breakGlassHeader = req.headers.get('x-break-glass-token')
    
    if (!breakGlassHeader) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing break-glass token header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fail closed: never authenticate against a fallback/default secret. If
    // the real token isn't configured, reject every request instead of
    // accepting one that matches a publicly-known placeholder value.
    const expectedToken = Deno.env.get('KEEPER_BREAK_GLASS_TOKEN')
    if (!expectedToken) {
      console.error('KEEPER_BREAK_GLASS_TOKEN is not configured -- rejecting all break-glass requests')
      return new Response(
        JSON.stringify({ success: false, message: 'Break-glass is not configured' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (breakGlassHeader !== expectedToken) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid break-glass token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body: BreakGlassRequest = await req.json()
    
    // Validate request
    if (!body.level || !body.ttl_minutes || !body.reason) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing required fields: level, ttl_minutes, reason' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate constraints
    if (body.level < 1 || body.level > 4) {
      return new Response(
        JSON.stringify({ success: false, message: 'Level must be between 1 and 4' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (body.ttl_minutes < 1 || body.ttl_minutes > 60) {
      return new Response(
        JSON.stringify({ success: false, message: 'TTL must be between 1 and 60 minutes' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get current circuit state
    const { data: currentState, error: stateError } = await supabase
      .from('keeper_circuit_state')
      .select('*')
      .eq('id', 1)
      .single()

    if (stateError) {
      throw new Error(`Failed to get circuit state: ${stateError.message}`)
    }

    // Apply break-glass override
    const expiresAt = new Date(Date.now() + body.ttl_minutes * 60 * 1000).toISOString()
    
    const { data: updateResult, error: updateError } = await supabase
      .from('keeper_circuit_state')
      .update({
        level: body.level,
        reason: `BREAK-GLASS: ${body.reason}`,
        set_by: body.requested_by || 'break-glass-operator',
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1)
      .select()

    if (updateError) {
      throw new Error(`Failed to update circuit state: ${updateError.message}`)
    }

    // Create audit entry
    const { data: auditResult, error: auditError } = await supabase
      .from('keeper_audit_log')
      .insert({
        request_id: crypto.randomUUID(),
        agent_id: body.requested_by || 'break-glass-operator',
        agent_role: 'break-glass-operator',
        action: 'break-glass:override',
        target: 'keeper_circuit_state',
        status: 'success',
        risk_level: body.level,
        details: {
          action: 'break_glass_override',
          previous_level: currentState.level,
          new_level: body.level,
          ttl_minutes: body.ttl_minutes,
          reason: body.reason,
          requested_by: body.requested_by,
          expires_at: expiresAt,
          auth_method: 'simple_token'
        },
        sensitive: true
      })
      .select()
      .single()

    if (auditError) {
      console.error('Failed to create audit entry:', auditError.message)
    }

    // Prepare response
    const response: BreakGlassResponse = {
      success: true,
      message: 'Break-glass override applied successfully',
      circuit_state: updateResult[0],
      audit_id: auditResult?.id
    }

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Break-glass error:', error.message)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: 'Internal server error',
        error: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
