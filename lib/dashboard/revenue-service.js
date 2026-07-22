/**
 * Shared revenue calculation logic.
 *
 * Used by:
 *   - apps/ursula-frontend/src/lib/dashboard/services/revenue-service.ts (typed wrapper)
 *   - api/client-dashboard.js (legacy compatibility adapter)
 *
 * This is the single implementation of ledger aggregation. Everything else
 * is an adapter over this module.
 */

const { createClient } = require('@supabase/supabase-js');

const REVENUE_STREAMS = [
  'galactic_bytes',
  'detailer_bot',
  'lipi_v2',
  'protogrance_aromatics',
  'rezonate',
  'waveformer_studio',
];

function toNum(value) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

async function fetchLedgerForProject(project) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const supabase = createClient(url, key);

  const { data: transactions, error } = await supabase
    .from('ledger')
    .select('*')
    .eq('project_code', project)
    .order('created_at', { ascending: false });

  if (error || !transactions) return null;

  const totals = transactions.reduce(
    (acc, tx) => {
      acc.total_gross += toNum(tx.amount_gross);
      acc.total_platform_fees += toNum(tx.platform_fee_amount);
      acc.total_agent_fees += toNum(tx.agent_fee_amount);
      acc.total_stripe_fees += toNum(tx.stripe_fee_amount);
      acc.total_net += toNum(tx.net_amount);

      if (tx.status === 'payout_completed') {
        acc.total_paid_out += toNum(tx.net_amount);
      } else if (tx.status === 'pending_dispute') {
        acc.held_for_disputes += toNum(tx.net_amount);
      } else {
        acc.available_for_payout += toNum(tx.net_amount);
      }

      return acc;
    },
    {
      total_gross: 0,
      total_platform_fees: 0,
      total_agent_fees: 0,
      total_stripe_fees: 0,
      total_net: 0,
      total_paid_out: 0,
      held_for_disputes: 0,
      available_for_payout: 0,
    }
  );

  const pendingPayoutTotal = transactions
    .filter((tx) => tx.status === 'payout_initiated')
    .reduce((sum, tx) => sum + toNum(tx.net_amount), 0);

  return { totals, transactions };
}

async function fetchRevenueForProject(project) {
  const ledger = await fetchLedgerForProject(project);
  if (!ledger) return null;

  const { totals, transactions } = ledger;
  const pendingPayoutTotal = transactions
    .filter((tx) => tx.status === 'payout_initiated')
    .reduce((sum, tx) => sum + toNum(tx.net_amount), 0);

  return {
    revenueStream: project,
    gross: toNum(totals.total_gross.toFixed(2)),
    fees: toNum((totals.total_platform_fees + totals.total_agent_fees + totals.total_stripe_fees).toFixed(2)),
    net: toNum(totals.total_net.toFixed(2)),
    availableForPayout: toNum(totals.available_for_payout.toFixed(2)),
    pendingPayout: toNum(pendingPayoutTotal.toFixed(2)),
    paidOut: toNum(totals.total_paid_out.toFixed(2)),
    heldForDisputes: toNum(totals.held_for_disputes.toFixed(2)),
    lastUpdated: new Date().toISOString(),
  };
}

async function fetchClientDashboard(project) {
  const ledger = await fetchLedgerForProject(project);
  if (!ledger) return null;

  const { totals, transactions } = ledger;

  const monthlyBreakdown = {};
  for (const tx of transactions) {
    const month = new Date(tx.created_at).toISOString().slice(0, 7); // YYYY-MM
    if (!monthlyBreakdown[month]) {
      monthlyBreakdown[month] = {
        gross: 0,
        fees: 0,
        net: 0,
        transaction_count: 0,
      };
    }
    monthlyBreakdown[month].gross += toNum(tx.amount_gross);
    monthlyBreakdown[month].fees +=
      toNum(tx.platform_fee_amount) + toNum(tx.agent_fee_amount) + toNum(tx.stripe_fee_amount);
    monthlyBreakdown[month].net += toNum(tx.net_amount);
    monthlyBreakdown[month].transaction_count++;
  }

  const recentTransactions = transactions.slice(0, 10).map((tx) => ({
    id: tx.transaction_id,
    date: tx.created_at,
    description: tx.description,
    gross: tx.amount_gross,
    platform_fee: tx.platform_fee_amount,
    agent_fee: tx.agent_fee_amount,
    stripe_fee: tx.stripe_fee_amount,
    net: tx.net_amount,
    status: tx.status,
  }));

  const pendingPayouts = transactions
    .filter((tx) => tx.status === 'payout_initiated')
    .map((tx) => ({
      id: tx.transaction_id,
      amount: tx.net_amount,
      initiated_at: tx.payout_initiated_at,
      batch_id: tx.payout_batch_id,
    }));

  const pendingPayoutsTotal = pendingPayouts.reduce((sum, p) => sum + toNum(p.amount), 0);

  return {
    project,
    revenue_stream: transactions[0]?.revenue_stream || project,
    last_updated: new Date().toISOString(),
    summary: {
      total_gross: toNum(totals.total_gross.toFixed(2)),
      total_fees: toNum((totals.total_platform_fees + totals.total_agent_fees + totals.total_stripe_fees).toFixed(2)),
      total_net: toNum(totals.total_net.toFixed(2)),
      total_paid_out: toNum(totals.total_paid_out.toFixed(2)),
      held_for_disputes: toNum(totals.held_for_disputes.toFixed(2)),
      available_for_payout: toNum(totals.available_for_payout.toFixed(2)),
      pending_payout_total: pendingPayoutsTotal.toFixed(2),
    },
    fee_breakdown: {
      platform_fees: toNum(totals.total_platform_fees.toFixed(2)),
      agent_fees: toNum(totals.total_agent_fees.toFixed(2)),
      stripe_fees: toNum(totals.total_stripe_fees.toFixed(2)),
    },
    monthly_breakdown: monthlyBreakdown,
    recent_transactions: recentTransactions,
    pending_payouts: pendingPayouts,
    transaction_count: transactions.length,
  };
}

module.exports = { fetchRevenueForProject, fetchClientDashboard, REVENUE_STREAMS };
