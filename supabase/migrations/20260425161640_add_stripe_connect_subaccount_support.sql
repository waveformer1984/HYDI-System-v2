-- ============================================
-- STRIPE CONNECT SUB-ACCOUNT LEDGER SUPPORT
-- ProtoForge Revenue Stream Tracking
-- ============================================

-- Drop existing ledger table to rebuild with proper structure
DROP TABLE IF EXISTS ledger CASCADE;

-- Create comprehensive ledger table with Stripe Connect support
CREATE TABLE ledger (
    -- Primary identifiers
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_payment_intent_id TEXT NOT NULL,
    stripe_charge_id TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Source tracking (Stripe Connect sub-account)
    source_account TEXT NOT NULL, -- Stripe Connect account ID (acct_xxx)
    revenue_stream TEXT NOT NULL, -- 'galactic_bytes', 'detailer_bot', etc.
    project_code TEXT NOT NULL, -- Internal project identifier
    
    -- Payment details
    amount_gross NUMERIC(12, 2) NOT NULL, -- Total amount before fees
    currency TEXT DEFAULT 'usd',
    
    -- Fee breakdown
    platform_fee_percent NUMERIC(5, 2) NOT NULL DEFAULT 5.00, -- Platform takes 5%
    agent_fee_percent NUMERIC(5, 2) NOT NULL DEFAULT 10.00, -- Agent pool takes 10%
    stripe_fee_percent NUMERIC(5, 2) NOT NULL DEFAULT 2.90, -- Stripe takes 2.9%
    stripe_fixed_fee NUMERIC(6, 2) NOT NULL DEFAULT 0.30, -- Stripe fixed $0.30
    
    -- Calculated fee amounts
    platform_fee_amount NUMERIC(12, 2) GENERATED ALWAYS AS (
        ROUND((amount_gross * platform_fee_percent / 100), 2)
    ) STORED,
    
    agent_fee_amount NUMERIC(12, 2) GENERATED ALWAYS AS (
        ROUND((amount_gross * agent_fee_percent / 100), 2)
    ) STORED,
    
    stripe_fee_amount NUMERIC(12, 2) GENERATED ALWAYS AS (
        ROUND((amount_gross * stripe_fee_percent / 100) + stripe_fixed_fee, 2)
    ) STORED,
    
    -- Net amount after ALL fees
    net_amount NUMERIC(12, 2) GENERATED ALWAYS AS (
        ROUND(
            amount_gross - 
            (amount_gross * platform_fee_percent / 100) - 
            (amount_gross * agent_fee_percent / 100) - 
            (amount_gross * stripe_fee_percent / 100) - 
            stripe_fixed_fee,
        2)
    ) STORED,
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'completed', 'failed', 'refunded', 'payout_initiated', 'payout_completed')),
    
    -- Payout tracking
    payout_batch_id TEXT,
    payout_initiated_at TIMESTAMPTZ,
    payout_completed_at TIMESTAMPTZ,
    stripe_payout_id TEXT,
    
    -- Customer info (for reference)
    customer_email TEXT,
    customer_name TEXT,
    
    -- Metadata
    description TEXT,
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT positive_amount CHECK (amount_gross > 0),
    CONSTRAINT valid_fee_percentages CHECK (
        platform_fee_percent >= 0 AND 
        agent_fee_percent >= 0 AND 
        stripe_fee_percent >= 0 AND
        stripe_fixed_fee >= 0
    )
);

-- Create indexes for common queries
CREATE INDEX idx_ledger_source_account ON ledger(source_account);
CREATE INDEX idx_ledger_revenue_stream ON ledger(revenue_stream);
CREATE INDEX idx_ledger_project_code ON ledger(project_code);
CREATE INDEX idx_ledger_status ON ledger(status);
CREATE INDEX idx_ledger_created_at ON ledger(created_at DESC);
CREATE INDEX idx_ledger_payout_batch ON ledger(payout_batch_id) WHERE payout_batch_id IS NOT NULL;
CREATE INDEX idx_ledger_stripe_payment ON ledger(stripe_payment_intent_id);

-- Create a view for easy reconciliation
CREATE OR REPLACE VIEW ledger_reconciliation AS
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
    SUM(CASE WHEN status IN ('pending', 'completed') THEN net_amount ELSE 0 END) as available_for_payout
FROM ledger
GROUP BY source_account, revenue_stream, project_code;

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION update_ledger_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ledger_timestamp
    BEFORE UPDATE ON ledger
    FOR EACH ROW
    EXECUTE FUNCTION update_ledger_updated_at();

-- Enable RLS
ALTER TABLE ledger ENABLE ROW LEVEL SECURITY;

-- Create policy for service role (full access)
CREATE POLICY "Service role full access" ON ledger
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Create policy for authenticated users (read-only)
CREATE POLICY "Authenticated users read-only" ON ledger
    FOR SELECT
    TO authenticated
    USING (true);

-- Insert test data for Galactic Bytes
INSERT INTO ledger (
    stripe_payment_intent_id,
    source_account,
    revenue_stream,
    project_code,
    amount_gross,
    currency,
    platform_fee_percent,
    agent_fee_percent,
    stripe_fee_percent,
    stripe_fixed_fee,
    status,
    description,
    customer_email,
    customer_name,
    metadata
) VALUES (
    'pi_test_galactic_001',
    'acct_test_galactic_bytes',
    'galactic_bytes',
    'galactic_bytes',
    1000.00,
    'usd',
    5.00,
    10.00,
    2.90,
    0.30,
    'completed',
    'Test transaction for Galactic Bytes revenue stream',
    'test@protoforge.dev',
    'Test Customer',
    '{"test": true, "setup": true}'::jsonb
);

-- Verify the test transaction with fee breakdown
SELECT 
    transaction_id,
    revenue_stream,
    amount_gross,
    platform_fee_amount,
    agent_fee_amount,
    stripe_fee_amount,
    net_amount,
    status
FROM ledger
WHERE revenue_stream = 'galactic_bytes';
