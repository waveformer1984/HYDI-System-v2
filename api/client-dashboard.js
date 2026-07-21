/**
 * Client Dashboard API
 * Shows project-filtered ledger with real-time earnings, fees, and pending payout
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../lib/structured-logger').child({ component: 'api/client-dashboard' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Get project code from query params (e.g., ?project=galactic_bytes)
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project code required' });
  }
  
  try {
    // Fetch ledger entries for this project
    const { data: transactions, error: txError } = await supabase
      .from('ledger')
      .select('*')
      .eq('project_code', project)
      .order('created_at', { ascending: false });
    
    if (txError) {
      throw txError;
    }
    
    // Calculate summary metrics
    const summary = transactions.reduce((acc, tx) => {
      acc.total_gross += parseFloat(tx.amount_gross);
      acc.total_platform_fees += parseFloat(tx.platform_fee_amount);
      acc.total_agent_fees += parseFloat(tx.agent_fee_amount);
      acc.total_stripe_fees += parseFloat(tx.stripe_fee_amount);
      acc.total_net += parseFloat(tx.net_amount);
      
      if (tx.status === 'payout_completed') {
        acc.total_paid_out += parseFloat(tx.net_amount);
      } else if (tx.status === 'pending_dispute') {
        acc.held_for_disputes += parseFloat(tx.net_amount);
      } else {
        acc.available_for_payout += parseFloat(tx.net_amount);
      }
      
      return acc;
    }, {
      total_gross: 0,
      total_platform_fees: 0,
      total_agent_fees: 0,
      total_stripe_fees: 0,
      total_net: 0,
      total_paid_out: 0,
      held_for_disputes: 0,
      available_for_payout: 0
    });
    
    // Get monthly breakdown
    const monthlyBreakdown = {};
    transactions.forEach(tx => {
      const month = new Date(tx.created_at).toISOString().slice(0, 7); // YYYY-MM
      if (!monthlyBreakdown[month]) {
        monthlyBreakdown[month] = {
          gross: 0,
          fees: 0,
          net: 0,
          transaction_count: 0
        };
      }
      monthlyBreakdown[month].gross += parseFloat(tx.amount_gross);
      monthlyBreakdown[month].fees += parseFloat(tx.platform_fee_amount) + parseFloat(tx.agent_fee_amount) + parseFloat(tx.stripe_fee_amount);
      monthlyBreakdown[month].net += parseFloat(tx.net_amount);
      monthlyBreakdown[month].transaction_count++;
    });
    
    // Get recent transactions (last 10)
    const recentTransactions = transactions.slice(0, 10).map(tx => ({
      id: tx.transaction_id,
      date: tx.created_at,
      description: tx.description,
      gross: tx.amount_gross,
      platform_fee: tx.platform_fee_amount,
      agent_fee: tx.agent_fee_amount,
      stripe_fee: tx.stripe_fee_amount,
      net: tx.net_amount,
      status: tx.status
    }));
    
    // Get pending payouts
    const pendingPayouts = transactions
      .filter(tx => tx.status === 'payout_initiated')
      .map(tx => ({
        id: tx.transaction_id,
        amount: tx.net_amount,
        initiated_at: tx.payout_initiated_at,
        batch_id: tx.payout_batch_id
      }));
    
    const dashboard = {
      project: project,
      revenue_stream: transactions[0]?.revenue_stream || project,
      last_updated: new Date().toISOString(),
      
      summary: {
        total_gross: parseFloat(summary.total_gross.toFixed(2)),
        total_fees: parseFloat((summary.total_platform_fees + summary.total_agent_fees + summary.total_stripe_fees).toFixed(2)),
        total_net: parseFloat(summary.total_net.toFixed(2)),
        total_paid_out: parseFloat(summary.total_paid_out.toFixed(2)),
        held_for_disputes: parseFloat(summary.held_for_disputes.toFixed(2)),
        available_for_payout: parseFloat(summary.available_for_payout.toFixed(2)),
        pending_payout_total: pendingPayouts.reduce((sum, p) => sum + parseFloat(p.amount), 0).toFixed(2)
      },
      
      fee_breakdown: {
        platform_fees: parseFloat(summary.total_platform_fees.toFixed(2)),
        agent_fees: parseFloat(summary.total_agent_fees.toFixed(2)),
        stripe_fees: parseFloat(summary.total_stripe_fees.toFixed(2))
      },
      
      monthly_breakdown: monthlyBreakdown,
      
      recent_transactions: recentTransactions,
      
      pending_payouts: pendingPayouts,
      
      transaction_count: transactions.length
    };
    
    res.status(200).json(dashboard);
    
  } catch (error) {
    logger.error('Client dashboard error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
}
