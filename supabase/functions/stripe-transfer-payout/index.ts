import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import Stripe from "npm:stripe@14.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// This function is explicitly listed in supabase/config.toml with
// verify_jwt = true, which only requires *some* cryptographically valid
// Supabase JWT -- which the public anon key satisfies. That's not
// sufficient here: this function moves real money. Supabase's platform
// layer has already verified the JWT's signature before this code runs, so
// it's safe to just decode the payload and check the role claim rather than
// re-verifying the signature ourselves.
function callerIsServiceRole(req: Request): boolean {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check endpoint
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: true,
        service: "stripe-transfer-payout",
        ts: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!callerIsServiceRole(req)) {
    return new Response(JSON.stringify({ error: "Forbidden: this function requires a service-role credential" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-04-10",
  });

  try {
    const { payout_id } = await req.json();

    if (!payout_id) {
      return new Response(
        JSON.stringify({ error: "payout_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[STRIPE-TRANSFER] Processing payout: ${payout_id}`);

    // Get payout details
    const { data: payout, error: payoutError } = await supabase
      .from('payouts')
      .select(`
        *,
        clients (
          client_id,
          client_name,
          email,
          stripe_customer_id,
          bank_account_token
        )
      `)
      .eq('payout_id', payout_id)
      .single();

    if (payoutError || !payout) {
      throw new Error(`Payout not found: ${payoutError?.message || 'Unknown error'}`);
    }

    if (payout.status !== 'pending' && payout.status !== 'scheduled') {
      return new Response(
        JSON.stringify({ 
          error: `Payout status is ${payout.status}, must be pending or scheduled`,
          current_status: payout.status
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const client = payout.clients;

    if (!client.stripe_customer_id) {
      throw new Error(`Client ${client.client_name} has no Stripe customer ID`);
    }

    if (!client.bank_account_token) {
      throw new Error(`Client ${client.client_name} has no bank account token`);
    }

    const amountInCents = Math.round(parseFloat(payout.net_payout_amount) * 100);

    console.log(`[STRIPE-TRANSFER] Transferring $${(amountInCents / 100).toFixed(2)} to ${client.client_name}`);

    // Create Stripe transfer to connected account
    // This assumes the client has a connected account set up
    let transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: amountInCents,
        currency: 'usd',
        destination: client.bank_account_token, // This should be the connected account ID
        metadata: {
          payout_id: payout_id,
          client_id: client.client_id,
          client_name: client.client_name,
          period_start: payout.period_start,
          period_end: payout.period_end,
          project_name: client.project_name
        },
        description: `ProtoForge payout for ${client.client_name} - ${payout.period_start} to ${payout.period_end}`
      });
    } catch (stripeError: any) {
      // Log the error and update payout status to failed
      await supabase
        .from('payouts')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString()
        })
        .eq('payout_id', payout_id);

      throw new Error(`Stripe transfer failed: ${stripeError.message}`);
    }

    console.log(`[STRIPE-TRANSFER] Transfer created: ${transfer.id}`);

    // Update payout record
    const { data: updatedPayout, error: updateError } = await supabase
      .from('payouts')
      .update({
        status: 'completed',
        stripe_transfer_id: transfer.id,
        updated_at: new Date().toISOString()
      })
      .eq('payout_id', payout_id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update payout: ${updateError.message}`);
    }

    // Log the transfer event
    await supabase.from('keymaker_events').insert({
      event_id: `stripe_transfer_${transfer.id}`,
      type: 'stripe_payout_transfer',
      source: 'stripe_transfer_function',
      severity: 'info',
      payload: {
        payout_id: payout_id,
        client_id: client.client_id,
        stripe_transfer_id: transfer.id,
        amount: payout.net_payout_amount,
        period_start: payout.period_start,
        period_end: payout.period_end
      },
      processed: true,
      occurred_at: new Date().toISOString()
    });

    // Send completion email
    await sendTransferCompleteEmail(client, updatedPayout, transfer.id, supabase);

    return new Response(
      JSON.stringify({
        success: true,
        payout_id: payout_id,
        stripe_transfer_id: transfer.id,
        amount: payout.net_payout_amount,
        status: 'completed',
        client: {
          id: client.client_id,
          name: client.client_name,
          email: client.email
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error('[STRIPE-TRANSFER] Error:', err);
    return new Response(
      JSON.stringify({ error: err.message, status: 'failed' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function sendTransferCompleteEmail(client: any, payout: any, transferId: string, supabase: any) {
  try {
    const emailContent = {
      to: client.email,
      subject: `Payout Completed - $${parseFloat(payout.net_payout_amount).toFixed(2)}`,
      body: `
Hello ${client.client_name},

Your payout has been successfully processed!

Amount: $${parseFloat(payout.net_payout_amount).toFixed(2)}
Period: ${payout.period_start} to ${payout.period_end}
Transfer ID: ${transferId}
Status: Completed

The funds should appear in your bank account within 1-2 business days.

Thank you for using ProtoForge!
      `.trim()
    };

    console.log(`[STRIPE-TRANSFER] Completion email would be sent to ${client.email}`);
    console.log(emailContent.body);

    // Log email event
    await supabase.from('keymaker_events').insert({
      event_id: `payout_complete_email_${payout.payout_id}`,
      type: 'payout_complete_email_sent',
      source: 'stripe_transfer_function',
      severity: 'info',
      payload: {
        client_id: client.client_id,
        payout_id: payout.payout_id,
        transfer_id: transferId,
        email: client.email
      },
      processed: true,
      occurred_at: new Date().toISOString()
    });

    return { success: true };
  } catch (err: any) {
    console.error(`[STRIPE-TRANSFER] Failed to send completion email:`, err);
    return { success: false, error: err.message };
  }
}
