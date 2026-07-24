import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { corsHeaders, requireServiceRole } from "../_shared/security.ts";

interface LedgerRow {
  source_account: string;
  amount_gross: number;
  platform_fee_percent: number;
  agent_fee_percent: number;
  platform_fee_amount: number;
  agent_fee_amount: number;
  net_amount: number;
}

interface Client {
  client_id: string;
  client_name: string;
  email: string;
  project_name: string;
  stripe_customer_id: string | null;
  bank_account_token: string | null;
  payout_schedule: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Internal-only: generates real payout records and reads client PII/
  // financial data for every active client. verify_jwt=true alone only
  // proves *a* JWT was presented (the public anon key qualifies), not that
  // the caller is privileged -- see ISSUES_FOUND.md.
  const authError = requireServiceRole(req);
  if (authError) return authError;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  try {
    // Calculate previous month period
    const now = new Date();
    const firstDayOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfPreviousMonth = new Date(firstDayOfCurrentMonth.getTime() - 1);
    const firstDayOfPreviousMonth = new Date(lastDayOfPreviousMonth.getFullYear(), lastDayOfPreviousMonth.getMonth(), 1);
    
    const periodStart = firstDayOfPreviousMonth.toISOString().split('T')[0];
    const periodEnd = lastDayOfPreviousMonth.toISOString().split('T')[0];
    
    const payoutDate = new Date(now.getFullYear(), now.getMonth(), 5); // 5th of current month
    const payoutDateStr = payoutDate.toISOString().split('T')[0];

    console.log(`[MONTHLY-PAYOUT] Processing for period: ${periodStart} to ${periodEnd}`);
    console.log(`[MONTHLY-PAYOUT] Payout date scheduled: ${payoutDateStr}`);

    // Get all active clients with monthly schedule
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .eq('payout_schedule', 'monthly');

    if (clientsError) {
      throw new Error(`Failed to fetch clients: ${clientsError.message}`);
    }

    if (!clients || clients.length === 0) {
      console.log('[MONTHLY-PAYOUT] No active clients with monthly payout schedule');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No clients to process',
          period: { start: periodStart, end: periodEnd }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[MONTHLY-PAYOUT] Found ${clients.length} clients to process`);

    const results = [];
    const errors = [];

    // Process each client
    for (const client of clients) {
      try {
        const result = await processClientPayout(
          client,
          periodStart,
          periodEnd,
          payoutDateStr,
          supabase
        );
        results.push(result);
      } catch (err: any) {
        console.error(`[MONTHLY-PAYOUT] Error processing client ${client.client_id}:`, err);
        errors.push({ client_id: client.client_id, error: err.message });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        period: { start: periodStart, end: periodEnd },
        payout_date: payoutDateStr,
        clients_processed: results.length,
        clients_failed: errors.length,
        results,
        errors
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('[MONTHLY-PAYOUT] Fatal error:', err);
    return new Response(
      JSON.stringify({ error: err.message, status: 'failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function processClientPayout(
  client: Client,
  periodStart: string,
  periodEnd: string,
  payoutDate: string,
  supabase: any
) {
  console.log(`[MONTHLY-PAYOUT] Processing client: ${client.client_name} (${client.email})`);

  // Query ledger for this client's earnings in the period
  // Match by project_name as the source_account
  const { data: ledgerEntries, error: ledgerError } = await supabase
    .from('financial_ledger')
    .select('*')
    .eq('source_account', client.project_name)
    .gte('created_at', `${periodStart}T00:00:00Z`)
    .lte('created_at', `${periodEnd}T23:59:59Z`)
    .eq('status', 'completed');

  if (ledgerError) {
    throw new Error(`Failed to query ledger: ${ledgerError.message}`);
  }

  if (!ledgerEntries || ledgerEntries.length === 0) {
    console.log(`[MONTHLY-PAYOUT] No earnings for ${client.client_name} in period`);
    return {
      client_id: client.client_id,
      client_name: client.client_name,
      status: 'no_earnings',
      message: 'No completed transactions in period'
    };
  }

  // Calculate totals
  let grossEarnings = 0;
  let platformFeeTotal = 0;
  let agentFeeTotal = 0;
  let netEarnings = 0;

  // Use the fee percentages from the most recent transaction
  let platformFeePercent = 0;
  let agentFeePercent = 0;

  for (const entry of ledgerEntries) {
    grossEarnings += parseFloat(entry.amount_gross);
    platformFeeTotal += parseFloat(entry.platform_fee_amount);
    agentFeeTotal += parseFloat(entry.agent_fee_amount);
    netEarnings += parseFloat(entry.net_amount);
    
    if (platformFeePercent === 0) {
      platformFeePercent = parseFloat(entry.platform_fee_percent);
    }
    if (agentFeePercent === 0) {
      agentFeePercent = parseFloat(entry.agent_fee_percent);
    }
  }

  console.log(`[MONTHLY-PAYOUT] ${client.client_name}: Gross=$${grossEarnings.toFixed(2)}, Platform Fee=$${platformFeeTotal.toFixed(2)}, Agent Fee=$${agentFeeTotal.toFixed(2)}, Net=$${netEarnings.toFixed(2)}`);

  // Check if payout already exists for this period
  const { data: existingPayout } = await supabase
    .from('payouts')
    .select('payout_id')
    .eq('client_id', client.client_id)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle();

  if (existingPayout) {
    console.log(`[MONTHLY-PAYOUT] Payout already exists for ${client.client_name} for this period`);
    return {
      client_id: client.client_id,
      client_name: client.client_name,
      status: 'already_exists',
      payout_id: existingPayout.payout_id
    };
  }

  // Create payout record
  const { data: payout, error: payoutError } = await supabase
    .from('payouts')
    .insert({
      client_id: client.client_id,
      period_start: periodStart,
      period_end: periodEnd,
      gross_earnings: grossEarnings,
      platform_fee_amount: platformFeeTotal,
      agent_fee_amount: agentFeeTotal,
      net_payout_amount: netEarnings,
      status: 'pending',
      payout_date: payoutDate
    })
    .select()
    .single();

  if (payoutError) {
    throw new Error(`Failed to create payout: ${payoutError.message}`);
  }

  // Send email notification
  const emailResult = await sendPayoutEmail(client, payout, ledgerEntries.length, supabase);

  console.log(`[MONTHLY-PAYOUT] Created payout ${payout.payout_id} for ${client.client_name}`);

  return {
    client_id: client.client_id,
    client_name: client.client_name,
    status: 'created',
    payout_id: payout.payout_id,
    earnings: {
      gross: grossEarnings,
      platform_fee: platformFeeTotal,
      agent_fee: agentFeeTotal,
      net: netEarnings,
      platform_fee_percent: platformFeePercent,
      agent_fee_percent: agentFeePercent,
      transaction_count: ledgerEntries.length
    },
    email_sent: emailResult.success,
    payout_date: payoutDate
  };
}

async function sendPayoutEmail(client: Client, payout: any, transactionCount: number, supabase: any) {
  try {
    // For now, log the email content - integrate with your email provider
    const emailContent = {
      to: client.email,
      subject: `Your Monthly Payout Summary - ${payout.period_start} to ${payout.period_end}`,
      body: `
Hello ${client.client_name},

Your monthly earnings summary for ${client.project_name}:

Period: ${payout.period_start} to ${payout.period_end}
Total Transactions: ${transactionCount}
Gross Earnings: $${parseFloat(payout.gross_earnings).toFixed(2)}
Platform Fee: $${parseFloat(payout.platform_fee_amount).toFixed(2)}
Agent Fee: $${parseFloat(payout.agent_fee_amount).toFixed(2)}
Net Payout: $${parseFloat(payout.net_payout_amount).toFixed(2)}

Payout Date: ${payout.payout_date}
Status: ${payout.status}

Thank you for using ProtoForge!
      `.trim()
    };

    console.log(`[MONTHLY-PAYOUT] Email would be sent to ${client.email}:`);
    console.log(emailContent.body);

    // TODO: Integrate with your email service (SendGrid, Resend, etc.)
    // Example:
    // await fetch('https://api.resend.com/emails', {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}` },
    //   body: JSON.stringify(emailContent)
    // });

    // Log email event
    await supabase.from('keymaker_events').insert({
      event_id: `payout_email_${payout.payout_id}`,
      type: 'payout_email_sent',
      source: 'monthly_payout_function',
      severity: 'info',
      payload: {
        client_id: client.client_id,
        payout_id: payout.payout_id,
        email: client.email,
        period: `${payout.period_start} to ${payout.period_end}`
      },
      processed: true,
      occurred_at: new Date().toISOString()
    });

    return { success: true };
  } catch (err: any) {
    console.error(`[MONTHLY-PAYOUT] Failed to send email:`, err);
    return { success: false, error: err.message };
  }
}
