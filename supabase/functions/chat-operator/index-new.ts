import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Tool whitelist - only these actions are allowed
const TOOL_WHITELIST = [
  'tool_create_invoice',
  'tool_pause_subscription', 
  'tool_create_support_ticket',
  'tool_refund_payment',
  'tool_update_customer_status'
]

// Simple intent detection
function detectIntent(message: string) {
  const lowerMessage = message.toLowerCase()
  
  if (lowerMessage.includes('invoice') || lowerMessage.includes('bill')) {
    return { intent: 'create_invoice', confidence: 0.9 }
  }
  
  if (lowerMessage.includes('pause') || lowerMessage.includes('stop') || lowerMessage.includes('cancel')) {
    return { intent: 'pause_subscription', confidence: 0.8 }
  }
  
  if (lowerMessage.includes('ticket') || lowerMessage.includes('support') || lowerMessage.includes('help')) {
    return { intent: 'create_support_ticket', confidence: 0.9 }
  }
  
  if (lowerMessage.includes('refund') || lowerMessage.includes('money back')) {
    return { intent: 'refund_payment', confidence: 0.9 }
  }
  
  if (lowerMessage.includes('status') || lowerMessage.includes('update')) {
    return { intent: 'update_customer_status', confidence: 0.7 }
  }
  
  return { intent: 'general_chat', confidence: 0.5 }
}

// Extract parameters from message
function extractParameters(message: string, intent: string) {
  const params: any = {}
  
  switch (intent) {
    case 'create_invoice':
      // Extract customer ID and amount
      const customerIdMatch = message.match(/customer\s+(\w+)/i)
      const amountMatch = message.match(/\$(\d+(?:\.\d{2})?)/i)
      if (customerIdMatch) params.customer_id = customerIdMatch[1]
      if (amountMatch) params.amount_cents = Math.round(parseFloat(amountMatch[1]) * 100)
      break
      
    case 'pause_subscription':
      // Extract subscription ID
      const subMatch = message.match(/subscription\s+(\w+)/i)
      if (subMatch) params.subscription_id = subMatch[1]
      break
      
    case 'refund_payment':
      // Extract payment ID and amount
      const paymentMatch = message.match(/payment\s+(\w+)/i)
      const refundAmountMatch = message.match(/\$(\d+(?:\.\d{2})?)/i)
      if (paymentMatch) params.payment_id = paymentMatch[1]
      if (refundAmountMatch) params.amount_cents = Math.round(parseFloat(refundAmountMatch[1]) * 100)
      break
      
    case 'update_customer_status':
      // Extract customer ID and new status
      const customerMatch = message.match(/customer\s+(\w+)/i)
      const statusMatch = message.match(/status\s+to\s+(\w+)/i)
      if (customerMatch) params.customer_id = customerMatch[1]
      if (statusMatch) params.new_status = statusMatch[1]
      break
  }
  
  return params
}

// Generate assistant response
function generateResponse(intent: string, params: any, actionResult?: any) {
  switch (intent) {
    case 'create_invoice':
      if (actionResult?.success) {
        return `Invoice created successfully! Invoice ID: ${actionResult.invoice_id} for $${(params.amount_cents / 100).toFixed(2)}`
      }
      return "I can create an invoice for you. Please specify the customer and amount."
      
    case 'pause_subscription':
      if (actionResult?.success) {
        return `Subscription ${params.subscription_id} has been paused successfully.`
      }
      return "I can pause a subscription for you. Please provide the subscription ID."
      
    case 'create_support_ticket':
      if (actionResult?.success) {
        return `Support ticket created successfully! Ticket ID: ${actionResult.ticket_id}`
      }
      return "I can create a support ticket for you. Please describe the issue."
      
    case 'refund_payment':
      if (actionResult?.success) {
        return `Refund processed successfully! Refund ID: ${actionResult.refund_id} for $${(params.amount_cents / 100).toFixed(2)}`
      }
      return "I can process a refund for you. Please provide the payment ID and amount."
      
    case 'update_customer_status':
      if (actionResult?.success) {
        return `Customer status updated to ${params.new_status} successfully!`
      }
      return "I can update a customer's status. Please specify the customer and new status."
      
    default:
      return "I'm here to help! I can create invoices, pause subscriptions, create support tickets, process refunds, and update customer status. What would you like to do?"
  }
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
          service: 'chat-operator',
          version: '1.0.0',
          capabilities: TOOL_WHITELIST
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }
    
    if (method === 'POST') {
      const body = await req.json()
      const { message, conversation_id } = body
      
      if (!message || !conversation_id) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: message, conversation_id' }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
          }
        )
      }
      
      // Initialize Supabase client
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      
      // Verify user owns the conversation
      const { data: conversation } = await supabase
        .from('chat_conversations')
        .select('*')
        .eq('id', conversation_id)
        .eq('owner_user_id', supabase.auth.getUser().then(u => u.user?.id))
        .single()
      
      if (!conversation) {
        return new Response(
          JSON.stringify({ error: 'Conversation not found or access denied' }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 403
          }
        )
      }
      
      // Detect intent
      const intent = detectIntent(message)
      const params = extractParameters(message, intent.intent)
      
      // Store user message
      await supabase.from('chat_messages').insert({
        conversation_id,
        sender_type: 'user',
        content: message,
        tool_call: null
      })
      
      let actionResult = null
      let assistantResponse = generateResponse(intent.intent, params)
      
      // Execute tool if intent matches a whitelisted tool and parameters are sufficient
      if (intent.intent !== 'general_chat' && TOOL_WHITELIST.includes(`tool_${intent.intent}`)) {
        try {
          // Create queued action
          const { data: action } = await supabase.from('operator_actions').insert({
            conversation_id,
            requested_by: supabase.auth.getUser().then(u => u.user?.id),
            action_name: `tool_${intent.intent}`,
            action_input: params,
            action_status: 'queued'
          }).select().single()
          
          // Broadcast action queued
          await supabase.from('chat_events').insert({
            conversation_id,
            event_type: 'action_queued',
            content: {
              action_id: action.id,
              action_name: action.action_name,
              parameters: params
            }
          })
          
          // Store assistant message with tool call
          await supabase.from('chat_messages').insert({
            conversation_id,
            sender_type: 'assistant',
            content: assistantResponse,
            tool_call: {
              intent: intent.intent,
              parameters: params,
              action_id: action.id
            }
          })
          
        } catch (error) {
          console.error('Action creation failed:', error)
          assistantResponse = `I understand you want to ${intent.intent.replace('_', ' ')}, but I need more information to proceed.`
        }
      } else {
        // Store general assistant message
        await supabase.from('chat_messages').insert({
          conversation_id,
          sender_type: 'assistant',
          content: assistantResponse,
          tool_call: null
        })
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          intent: intent,
          response: assistantResponse,
          conversation_id
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
    console.error('[CHAT-OPERATOR] Error:', error)
    
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
