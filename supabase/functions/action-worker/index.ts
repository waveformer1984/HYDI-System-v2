import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, requireServiceRole } from '../_shared/security.ts'

// Process queued actions
async function processQueuedActions(supabase: any, limit: number = 10) {
  // Get queued actions
  const { data: actions, error } = await supabase
    .from('operator_actions')
    .select('*')
    .eq('action_status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit)
  
  if (error) {
    throw new Error(`Failed to fetch queued actions: ${error.message}`)
  }
  
  const results = []
  
  for (const action of actions) {
    try {
      // Call tool-executor to process this action
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/tool-executor`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action_id: action.id })
      })
      
      if (!response.ok) {
        throw new Error(`Tool executor failed: ${response.statusText}`)
      }
      
      const result = await response.json()
      results.push({
        action_id: action.id,
        success: result.success,
        result: result.result,
        error: result.error
      })
      
    } catch (error) {
      console.error(`Failed to process action ${action.id}:`, error)
      
      // Mark action as failed
      await supabase
        .from('operator_actions')
        .update({ 
          action_status: 'failed',
          error_text: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', action.id)
      
      results.push({
        action_id: action.id,
        success: false,
        error: error.message
      })
    }
  }
  
  return results
}

// Main handler
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const method = req.method
    const url = new URL(req.url)
    
    if (method === 'GET') {
      // Health check
      return new Response(
        JSON.stringify({ 
          status: 'active',
          service: 'action-worker',
          version: '1.0.0',
          description: 'Processes queued operator actions'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }
    
    if (method === 'POST') {
      // Internal-only: processes queued operator_actions using the
      // service-role key. verify_jwt=true alone only proves *a* JWT was
      // presented (the public anon key qualifies), not that the caller is
      // privileged -- see ISSUES_FOUND.md.
      const authError = requireServiceRole(req)
      if (authError) return authError

      const body = await req.json()
      const { limit = 10, batch_mode = false, action_id } = body

      // Initialize Supabase client
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      
      if (action_id) {
        // Process single action
        const { data: action, error: actionError } = await supabase
          .from('operator_actions')
          .select('*')
          .eq('id', action_id)
          .single()
        
        if (actionError || !action) {
          return new Response(
            JSON.stringify({ error: 'Action not found' }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 404
            }
          )
        }
        
        if (action.action_status !== 'queued') {
          return new Response(
            JSON.stringify({ error: 'Action is not in queued status' }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400
            }
          )
        }
        
        // Process the action
        const results = await processQueuedActions(supabase, 1)
        const result = results.find(r => r.action_id === action_id)
        
        return new Response(
          JSON.stringify({
            success: result?.success || false,
            action_id: action_id,
            result: result?.result,
            error: result?.error
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: result?.success ? 200 : 500
          }
        )
      } else {
        // Process multiple queued actions (batch mode or default)
        const results = await processQueuedActions(supabase, limit)
        
        return new Response(
          JSON.stringify({
            success: true,
            processed: results.length,
            results: results
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          }
        )
      }
    }
    
    return new Response('Method not allowed', { 
      headers: corsHeaders,
      status: 405 
    })
  } catch (error) {
    console.error('[ACTION-WORKER] Error:', error)
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
