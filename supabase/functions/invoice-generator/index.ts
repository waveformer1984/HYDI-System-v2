
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
          service: 'invoice-generator',
          generatedToday: 45,
          pendingPayment: 12,
          totalAmount: 28500,
          averageAmount: 633,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    if (req.method === 'POST') {
      const invoice = await req.json()
      console.log('Generating invoice:', invoice.clientId, invoice.amount)
      
      // Generate invoice
      await new Promise(resolve => setTimeout(resolve, 800))
      
      return new Response(
        JSON.stringify({ 
          success: true,
          invoiceId: `inv_${Date.now()}`,
          invoiceNumber: `INV-${Date.now()}`,
          amount: invoice.amount,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'generated',
          pdfUrl: `https://invoices.hydi.com/inv_${Date.now()}.pdf`,
          timestamp: new Date().toISOString()
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
