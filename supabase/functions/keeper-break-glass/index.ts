import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jwtVerify } from 'https://deno.land/x/jose@v4.1.5/index.ts'

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
    // Verify authorization
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    
    // Verify JWT token (or simple token for testing)
    let payload: any
    try {
      if (token.startsWith('ey')) {
        // JWT token - use the secret as HMAC key
        const secretKey = Deno.env.get('KEEPER_BREAK_GLASS_TOKEN') || 'fallback-secret'
        const { payload: jwtPayload } = await jwtVerify(
          token,
          new TextEncoder().encode(secretKey)
        )
        payload = jwtPayload
      } else {
        // Simple token validation
        const expectedToken = Deno.env.get('KEEPER_BREAK_GLASS_TOKEN')
        if (token !== expectedToken) {
          throw new Error('Invalid token')
        }
        payload = { sub: 'simple-token', role: 'break-glass-operator' }
      }
    } catch (error) {
      console.error('JWT verification error:', error.message)
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Invalid authorization token',
          debug: error.message 
        }),
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
        set_by: payload.sub || 'break-glass-operator',
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
        agent_id: payload.sub || 'break-glass-operator',
        agent_role: payload.role || 'break-glass-operator',
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
          requested_by: body.requested_by || payload.sub,
          expires_at: expiresAt,
          auth_method: token.startsWith('ey') ? 'jwt' : 'simple'
        },
        sensitive: true
      })
      .select()
      .single()

    if (auditError) {
      console.error('Failed to create audit entry:', auditError.message)
      // Continue anyway - the override was applied
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
