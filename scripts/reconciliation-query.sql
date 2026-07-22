-- ============================================
-- STRIPE CONNECT RECONCILIATION QUERIES
-- ProtoForge Revenue Stream Reconciliation
-- ============================================

-- Query 1: Full Ledger Summary by Sub-Account
-- Matches financial_ledger rows against Stripe Connect payouts

WITH financial_ledger_summary AS (
    SELECT 
        source_account,
        revenue_stream,
        project_code,
        COUNT(*) as transaction_count,
        SUM(amount_gross) as total_gross,
        SUM(platform_fee_amount) as total_platform_fees,
        SUM(agent_fee_amount) as total_agent_fees,
        SUM(stripe_fee_amount) as total_stripe_fees,
        SUM(net_amount) as total_net,
        SUM(CASE WHEN status = 'payout_completed' THEN net_amount ELSE 0 END) as total_paid_out,
        SUM(CASE WHEN status IN ('completed', 'pending') THEN net_amount ELSE 0 END) as available_for_payout
    FROM financial_ledger
    GROUP BY source_account, revenue_stream, project_code
),
payout_summary AS (
    -- This would come from Stripe API in practice
    -- For now, using financial_ledger payout tracking
    SELECT 
        source_account,
        payout_batch_id,
        COUNT(*) as transactions_in_batch,
        SUM(net_amount) as batch_total
    FROM financial_ledger
    WHERE payout_batch_id IS NOT NULL
    GROUP BY source_account, payout_batch_id
)
SELECT 
    ls.source_account,
    ls.revenue_stream,
    ls.project_code,
    ls.transaction_count,
    ls.total_gross,
    ls.total_platform_fees,
    ls.total_agent_fees,
    ls.total_stripe_fees,
    ls.total_net,
    ls.total_paid_out,
    ls.available_for_payout,
    (ls.total_net - ls.total_paid_out) as pending_payout
FROM financial_ledger_summary ls
ORDER BY ls.revenue_stream;

-- ============================================

-- Query 2: Detailed Fee Breakdown Report
-- Shows exactly where every dollar goes

SELECT 
    revenue_stream,
    DATE_TRUNC('month', created_at) as month,
    COUNT(*) as transaction_count,
    SUM(amount_gross) as gross_revenue,
    SUM(platform_fee_amount) as platform_revenue,
    SUM(agent_fee_amount) as agent_pool,
    SUM(stripe_fee_amount) as stripe_fees,
    SUM(net_amount) as net_to_subaccount,
    ROUND(SUM(platform_fee_amount) / SUM(amount_gross) * 100, 2) as platform_fee_pct,
    ROUND(SUM(agent_fee_amount) / SUM(amount_gross) * 100, 2) as agent_fee_pct,
    ROUND(SUM(stripe_fee_amount) / SUM(amount_gross) * 100, 2) as stripe_fee_pct,
    ROUND(SUM(net_amount) / SUM(amount_gross) * 100, 2) as net_pct
FROM financial_ledger
WHERE status NOT IN ('failed', 'refunded')
GROUP BY revenue_stream, DATE_TRUNC('month', created_at)
ORDER BY month DESC, revenue_stream;

-- ============================================

-- Query 3: Payout Reconciliation
-- Matches financial_ledger payouts against Stripe Connect payouts

SELECT 
    l.payout_batch_id,
    l.source_account,
    l.revenue_stream,
    COUNT(l.transaction_id) as transaction_count,
    SUM(l.net_amount) as financial_ledger_payout_total,
    MIN(l.payout_initiated_at) as initiated_at,
    MAX(l.payout_completed_at) as completed_at,
    -- In production, this would join with Stripe payout data
    -- For now, showing the financial_ledger view
    CASE 
        WHEN MAX(l.payout_completed_at) IS NOT NULL THEN 'COMPLETED'
        WHEN MIN(l.payout_initiated_at) IS NOT NULL THEN 'INITIATED'
        ELSE 'PENDING'
    END as payout_status
FROM financial_ledger l
WHERE l.payout_batch_id IS NOT NULL
GROUP BY l.payout_batch_id, l.source_account, l.revenue_stream
ORDER BY l.payout_initiated_at DESC;

-- ============================================

-- Query 4: Unreconciled Transactions
-- Find transactions that haven't been matched to payouts

SELECT 
    transaction_id,
    stripe_payment_intent_id,
    revenue_stream,
    amount_gross,
    net_amount,
    status,
    created_at,
    EXTRACT(DAY FROM NOW() - created_at) as days_since_transaction
FROM financial_ledger
WHERE status IN ('completed', 'pending')
  AND payout_batch_id IS NULL
ORDER BY created_at DESC;

-- ============================================

-- Query 5: Revenue Stream Performance Dashboard
-- Quick overview of all revenue streams

SELECT 
    'galactic_bytes' as revenue_stream,
    COALESCE(SUM(CASE WHEN revenue_stream = 'galactic_bytes' THEN amount_gross END), 0) as total_gross,
    COALESCE(SUM(CASE WHEN revenue_stream = 'galactic_bytes' THEN net_amount END), 0) as total_net,
    COALESCE(COUNT(CASE WHEN revenue_stream = 'galactic_bytes' THEN 1 END), 0) as transaction_count
FROM financial_ledger
UNION ALL
SELECT 
    'detailer_bot' as revenue_stream,
    COALESCE(SUM(CASE WHEN revenue_stream = 'detailer_bot' THEN amount_gross END), 0) as total_gross,
    COALESCE(SUM(CASE WHEN revenue_stream = 'detailer_bot' THEN net_amount END), 0) as total_net,
    COALESCE(COUNT(CASE WHEN revenue_stream = 'detailer_bot' THEN 1 END), 0) as transaction_count
FROM financial_ledger
UNION ALL
SELECT 
    'lipi_v2' as revenue_stream,
    COALESCE(SUM(CASE WHEN revenue_stream = 'lipi_v2' THEN amount_gross END), 0) as total_gross,
    COALESCE(SUM(CASE WHEN revenue_stream = 'lipi_v2' THEN net_amount END), 0) as total_net,
    COALESCE(COUNT(CASE WHEN revenue_stream = 'lipi_v2' THEN 1 END), 0) as transaction_count
FROM financial_ledger
UNION ALL
SELECT 
    'protogrance_aromatics' as revenue_stream,
    COALESCE(SUM(CASE WHEN revenue_stream = 'protogrance_aromatics' THEN amount_gross END), 0) as total_gross,
    COALESCE(SUM(CASE WHEN revenue_stream = 'protogrance_aromatics' THEN net_amount END), 0) as total_net,
    COALESCE(COUNT(CASE WHEN revenue_stream = 'protogrance_aromatics' THEN 1 END), 0) as transaction_count
FROM financial_ledger
UNION ALL
SELECT 
    'rezonate' as revenue_stream,
    COALESCE(SUM(CASE WHEN revenue_stream = 'rezonate' THEN amount_gross END), 0) as total_gross,
    COALESCE(SUM(CASE WHEN revenue_stream = 'rezonate' THEN net_amount END), 0) as total_net,
    COALESCE(COUNT(CASE WHEN revenue_stream = 'rezonate' THEN 1 END), 0) as transaction_count
FROM financial_ledger
UNION ALL
SELECT 
    'waveformer_studio' as revenue_stream,
    COALESCE(SUM(CASE WHEN revenue_stream = 'waveformer_studio' THEN amount_gross END), 0) as total_gross,
    COALESCE(SUM(CASE WHEN revenue_stream = 'waveformer_studio' THEN net_amount END), 0) as total_net,
    COALESCE(COUNT(CASE WHEN revenue_stream = 'waveformer_studio' THEN 1 END), 0) as transaction_count
FROM financial_ledger;

-- ============================================

-- Query 6: Test Transaction Verification
-- Verify the Galactic Bytes test transaction

SELECT 
    transaction_id,
    stripe_payment_intent_id,
    revenue_stream,
    source_account,
    amount_gross,
    platform_fee_amount,
    agent_fee_amount,
    stripe_fee_amount,
    net_amount,
    status,
    created_at,
    description
FROM financial_ledger
WHERE revenue_stream = 'galactic_bytes'
ORDER BY created_at DESC
LIMIT 1;
