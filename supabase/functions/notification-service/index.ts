
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Notification templates
const TEMPLATES = {
  welcome: {
    sms: "Welcome to HYDI! Your account is ready. Get started at https://hydi.app",
    email: {
      subject: "Welcome to HYDI!",
      html: "Welcome to HYDI! 🎉\n\nYour account has been successfully created and is ready to use.\n\nGet started at: https://hydi.app\n\nNeed help? Reply to this email or visit our support center."
    }
  },
  invoice_created: {
    sms: "HYDI: Invoice #{invoiceId} for ${amount} has been created. View at https://hydi.app/invoices",
    email: {
      subject: "Invoice Created - HYDI",
      html: "Invoice Created 💰\n\nInvoice #{invoiceId} for ${amount} has been created and is now available.\n\nView invoice: https://hydi.app/invoices/{invoiceId}\n\nDue date: {dueDate}"
    }
  },
  action_completed: {
    sms: "HYDI: Your request '{action}' has been completed successfully. Status: {status}",
    email: {
      subject: "Action Completed - HYDI",
      html: "Action Completed ✅\n\nYour request \"{action}\" has been completed successfully.\n\nStatus: {status}\nCompleted at: {completedAt}\n\nView dashboard: https://hydi.app/dashboard"
    }
  }
}

// Send SMS via Twilio
async function sendSMS(to: string, message: string) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER')

  if (!accountSid || !authToken || !fromNumber) {
    console.warn('Twilio credentials not configured, simulating SMS send')
    return { success: true, sid: `sim_${Date.now()}`, status: 'sent' }
  }

  const credentials = btoa(`${accountSid}:${authToken}`)
  
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: to,
        From: fromNumber,
        Body: message,
      }),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Twilio API error: ${error}`)
  }

  const result = await response.json()
  return { success: true, sid: result.sid, status: result.status }
}

// Send Email via SendGrid
async function sendEmail(to: string, subject: string, html: string) {
  const sendGridKey = Deno.env.get('SENDGRID_API_KEY')
  const fromEmail = Deno.env.get('FROM_EMAIL') || 'noreply@hydi.app'

  if (!sendGridKey) {
    console.warn('SendGrid key not configured, simulating email send')
    return { success: true, id: `sim_${Date.now()}`, status: 'sent' }
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sendGridKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`SendGrid API error: ${error}`)
  }

  const messageId = response.headers.get('X-Message-Id')
  return { success: true, id: messageId, status: 'sent' }
}

// Log notification to database
async function logNotification(
  supabase: any,
  type: string,
  recipient: string,
  channel: string,
  status: string,
  template: string,
  metadata: any = {}
) {
  const { error } = await supabase
    .from('notifications')
    .insert({
      type,
      recipient,
      channel,
      status,
      template,
      metadata,
      created_at: new Date().toISOString(),
    })

  if (error) {
    console.error('Failed to log notification:', error)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    if (req.method === 'GET') {
      // Health check and stats
      const { data: notifications, error } = await supabase
        .from('notifications')
        .select('status, channel')
        .order('created_at', { ascending: false })
        .limit(1000)

      const stats = {
        total: notifications?.length || 0,
        delivered: notifications?.filter(n => n.status === 'delivered').length || 0,
        sent: notifications?.filter(n => n.status === 'sent').length || 0,
        failed: notifications?.filter(n => n.status === 'failed').length || 0,
        sms: notifications?.filter(n => n.channel === 'sms').length || 0,
        email: notifications?.filter(n => n.channel === 'email').length || 0,
      }

      return new Response(
        JSON.stringify({ 
          status: 'active',
          service: 'notification-service',
          version: '2.0.0',
          stats,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const { type, recipient, channel, template, data = {} } = await req.json()
      
      if (!type || !recipient || !channel || !template) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: type, recipient, channel, template' }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
          }
        )
      }

      const templateData = TEMPLATES[template as keyof typeof TEMPLATES]
      if (!templateData) {
        return new Response(
          JSON.stringify({ error: `Template '${template}' not found` }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
          }
        )
      }

      let result
      let message

      try {
        if (channel === 'sms') {
          message = templateData.sms.replace(/\{(\w+)\}/g, (_, key) => data[key] || '')
          result = await sendSMS(recipient, message)
        } else if (channel === 'email') {
          const emailTemplate = templateData.email
          const subject = emailTemplate.subject.replace(/\{(\w+)\}/g, (_, key) => data[key] || '')
          const html = emailTemplate.html.replace(/\{(\w+)\}/g, (_, key) => data[key] || '')
          result = await sendEmail(recipient, subject, html)
        } else {
          return new Response(
            JSON.stringify({ error: `Channel '${channel}' not supported` }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400
            }
          )
        }

        // Log successful notification
        const messageId = (result as any).id || (result as any).sid
        await logNotification(
          supabase,
          type,
          recipient,
          channel,
          'sent',
          template,
          { ...data, messageId }
        )

        return new Response(
          JSON.stringify({ 
            success: true,
            notificationId: `notif_${Date.now()}`,
            type,
            recipient,
            channel,
            template,
            status: (result as any).status,
            messageId,
            sentAt: new Date().toISOString()
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          }
        )

      } catch (error) {
        // Log failed notification
        await logNotification(
          supabase,
          type,
          recipient,
          channel,
          'failed',
          template,
          { ...data, error: error.message }
        )

        throw error
      }
    }

    return new Response('Method not allowed', { 
      headers: corsHeaders,
      status: 405 
    })
  } catch (error) {
    console.error('[NOTIFICATION-SERVICE] Error:', error)
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
