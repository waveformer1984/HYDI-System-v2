import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// LLM Integration (simplified)
async function getIntent(message: string, context: any) {
  // Simple intent detection - in production, use actual LLM
  const lowerMessage = message.toLowerCase()
  
  if (lowerMessage.includes('refund') || lowerMessage.includes('money back')) {
    return { intent: 'refund', confidence: 0.9, entities: extractEntities(message) }
  }
  
  if (lowerMessage.includes('ticket') || lowerMessage.includes('help') || lowerMessage.includes('support')) {
    return { intent: 'create_ticket', confidence: 0.8, entities: extractEntities(message) }
  }
  
  if (lowerMessage.includes('escalate') || lowerMessage.includes('manager') || lowerMessage.includes('supervisor')) {
    return { intent: 'escalate', confidence: 0.9, entities: extractEntities(message) }
  }
  
  if (lowerMessage.includes('status') || lowerMessage.includes('order') || lowerMessage.includes('track')) {
    return { intent: 'check_status', confidence: 0.7, entities: extractEntities(message) }
  }
  
  return { intent: 'general_inquiry', confidence: 0.5, entities: extractEntities(message) }
}

function extractEntities(message: string) {
  const entities = []
  
  // Extract order numbers (simplified)
  const orderMatch = message.match(/(?:order|invoice|ticket)\s*#?(\w+)/i)
  if (orderMatch) {
    entities.push({ type: 'order_id', value: orderMatch[1] })
  }
  
  // Extract amounts
  const amountMatch = message.match(/\$(\d+(?:\.\d{2})?)/)
  if (amountMatch) {
    entities.push({ type: 'amount', value: parseFloat(amountMatch[1]) })
  }
  
  return entities
}

// Tool execution
async function executeTool(intent: any, context: any, supabase: any) {
  const { user_id, session_id } = context
  
  switch (intent.intent) {
    case 'refund':
      return await handleRefund(intent, context, supabase)
    
    case 'create_ticket':
      return await handleCreateTicket(intent, context, supabase)
    
    case 'escalate':
      return await handleEscalate(intent, context, supabase)
    
    case 'check_status':
      return await handleStatusCheck(intent, context, supabase)
    
    default:
      return await handleGeneralInquiry(intent, context, supabase)
  }
}

async function handleRefund(intent: any, context: any, supabase: any) {
  const { user_id, session_id } = context
  
  // Validate user has refund permission
  const { data: permissions } = await supabase.rpc('get_user_permissions', { p_user_id: user_id })
  
  const hasRefundPermission = permissions.some((p: any) => p.permission_type === 'refund')
  
  if (!hasRefundPermission) {
    return {
      action: 'request_permission',
      permission_type: 'refund',
      message: "I need permission to process refunds. Let me escalate this to a supervisor."
    }
  }
  
  // Extract refund details
  const amount = intent.entities.find((e: any) => e.type === 'amount')?.value
  const orderId = intent.entities.find((e: any) => e.type === 'order_id')?.value
  
  if (!amount || !orderId) {
    return {
      action: 'request_info',
      message: "I need more information to process a refund. Please provide the order number and refund amount."
    }
  }
  
  // Call database function to issue refund
  const { data: refundId, error } = await supabase.rpc('issue_refund', {
    p_operator_id: user_id,
    p_session_id: session_id,
    p_refund_data: {
      amount,
      order_id: orderId,
      reason: 'Customer requested refund',
      user_message: context.message
    }
  })
  
  if (error) {
    throw new Error(`Refund processing failed: ${error.message}`)
  }
  
  return {
    action: 'refund_processed',
    refund_id: refundId,
    amount,
    order_id: orderId,
    message: `Refund of $${amount} for order ${orderId} has been processed. Refund ID: ${refundId}`
  }
}

async function handleCreateTicket(intent: any, context: any, supabase: any) {
  const { user_id, session_id } = context
  
  // Create ticket
  const { data: ticketId, error } = await supabase.rpc('create_ticket', {
    p_user_id: user_id,
    p_session_id: session_id,
    p_ticket_data: {
      subject: intent.entities.find((e: any) => e.type === 'order_id')?.value || 'General Inquiry',
      description: context.message,
      priority: 'normal',
      category: detectCategory(context.message)
    }
  })
  
  if (error) {
    throw new Error(`Ticket creation failed: ${error.message}`)
  }
  
  return {
    action: 'ticket_created',
    ticket_id: ticketId,
    message: `Ticket #${ticketId} has been created. Our support team will review it shortly.`
  }
}

async function handleEscalate(intent: any, context: any, supabase: any) {
  const { user_id, session_id } = context
  
  // Queue escalation workflow
  const { data: stepId, error } = await supabase.rpc('run_workflow_step', {
    p_operator_id: user_id,
    p_session_id: session_id,
    p_workflow_data: {
      workflow_type: 'escalation',
      reason: context.message,
      async: true,
      priority: 'high'
    }
  })
  
  if (error) {
    throw new Error(`Escalation failed: ${error.message}`)
  }
  
  return {
    action: 'escalated',
    step_id: stepId,
    message: "Your request has been escalated to a supervisor. They will review it shortly."
  }
}

async function handleStatusCheck(intent: any, context: any, supabase: any) {
  const orderId = intent.entities.find((e: any) => e.type === 'order_id')?.value
  
  if (!orderId) {
    return {
      action: 'request_info',
      message: "I need an order number to check the status. Please provide the order number."
    }
  }
  
  // In production, integrate with actual order management system
  // For now, simulate status check
  const status = simulateOrderStatus(orderId)
  
  return {
    action: 'status_check',
    order_id: orderId,
    status: status.status,
    message: `Order ${orderId} is currently ${status.status}. ${status.message}`
  }
}

async function handleGeneralInquiry(intent: any, context: any, supabase: any) {
  const { user_id, session_id } = context
  
  // Get chat history for context
  const { data: history } = await supabase.rpc('get_chat_history', {
    p_session_id: session_id,
    p_limit: 10
  })
  
  // Generate response based on context
  const response = generateGeneralResponse(context.message, history)
  
  return {
    action: 'general_response',
    message: response
  }
}

function simulateOrderStatus(orderId: string) {
  // Simulate order status - in production, integrate with real system
  const statuses = ['processing', 'shipped', 'delivered', 'cancelled'] as const
  const status = statuses[Math.floor(Math.random() * statuses.length)]
  
  const messages: Record<string, string> = {
    processing: 'Your order is being prepared for shipment.',
    shipped: 'Your order has been shipped and is on its way.',
    delivered: 'Your order has been delivered successfully.',
    cancelled: 'This order has been cancelled.'
  }
  
  return { status, message: messages[status] }
}

function generateGeneralResponse(message: string, history: any[]) {
  // Simple response generation - in production, use actual LLM
  const lowerMessage = message.toLowerCase()
  
  if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
    return "Hello! How can I help you today?"
  }
  
  if (lowerMessage.includes('thank')) {
    return "You're welcome! Is there anything else I can help you with?"
  }
  
  if (lowerMessage.includes('bye')) {
    return "Goodbye! Have a great day!"
  }
  
  return "I understand your message. Let me help you with that or connect you with a human agent if needed."
}

function detectCategory(message: string): string {
  const lowerMessage = message.toLowerCase()
  
  if (lowerMessage.includes('billing') || lowerMessage.includes('payment')) return 'billing'
  if (lowerMessage.includes('technical') || lowerMessage.includes('bug')) return 'technical'
  if (lowerMessage.includes('product') || lowerMessage.includes('service')) return 'product'
  
  return 'general'
}

// Main handler
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { method } = req
    
    if (method === 'GET') {
      // Health check
      return new Response(
        JSON.stringify({ 
          status: 'active',
          service: 'chat-operator',
          version: '1.0.0',
          capabilities: ['intent_detection', 'tool_execution', 'realtime_updates']
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }
    
    if (method === 'POST') {
      const body = await req.json()
      const { message, session_id, user_id } = body
      
      if (!message || !session_id || !user_id) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: message, session_id, user_id' }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
          }
        )
      }
      
      // Initialize Supabase client
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      
      // Get session details
      const { data: session } = await supabaseClient.rpc('get_session_details', {
        p_session_id: session_id
      })
      
      if (!session || session.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Invalid session' }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 404
          }
        )
      }
      
      // Detect intent
      const intent = await getIntent(message, { session, user_id })
      
      // Execute appropriate tool
      const result = await executeTool(intent, { session, user_id, message }, supabaseClient)
      
      // Store user message
      await supabaseClient.from('chat_messages').insert({
        session_id,
        sender_type: 'user',
        sender_id: user_id,
        content: message,
        message_type: 'text',
        metadata: {
          intent: intent.intent,
          confidence: intent.confidence
        }
      })
      
      // Store operator response
      await supabaseClient.from('chat_messages').insert({
        session_id,
        sender_type: 'operator',
        sender_id: 'chat-operator',
        content: result.message,
        message_type: result.action,
        metadata: result
      })
      
      // Broadcast update
      await supabaseClient.from('chat_events').insert({
        session_id,
        user_id,
        event_type: 'operator_action',
        content: {
          action: result.action,
          message: result.message,
          metadata: result
        },
        metadata: {
          operator_id: user_id
        }
      })
      
      return new Response(
        JSON.stringify({
          success: true,
          intent: intent,
          result: result,
          session_id
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
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
