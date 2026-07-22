-- ProtoForge Payout System Setup
-- Run this in the Supabase SQL Editor

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
    client_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_name text NOT NULL,
    project_name text NOT NULL,
    stripe_customer_id text unique,
    bank_account_token text,
    email text unique NOT NULL,
    payout_schedule text NOT NULL DEFAULT 'monthly' check (payout_schedule in ('monthly', 'custom')),
    status text NOT NULL DEFAULT 'active' check (status in ('active', 'inactive', 'suspended')),
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Create payouts table
CREATE TABLE IF NOT EXISTS payouts (
    payout_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL references clients(client_id) on delete cascade,
    period_start date NOT NULL,
    period_end date NOT NULL,
    gross_earnings numeric NOT NULL DEFAULT 0,
    platform_fee_amount numeric NOT NULL DEFAULT 0,
    agent_fee_amount numeric NOT NULL DEFAULT 0,
    net_payout_amount numeric NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending' check (status in ('pending', 'scheduled', 'completed', 'failed')),
    payout_date date,
    stripe_transfer_id text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Create financial_ledger table if it doesn't exist
CREATE TABLE IF NOT EXISTS financial_ledger (
    transaction_id uuid primary key default gen_random_uuid(),
    created_at timestamptz default now(),
    source_account text not null,
    amount_gross numeric not null,
    platform_fee_percent numeric not null,
    agent_fee_percent numeric not null,
    platform_fee_amount numeric not null,
    agent_fee_amount numeric not null,
    net_amount numeric not null,
    status text not null default 'pending',
    payout_batch_id text
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_stripe_customer ON clients(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_payouts_client_id ON payouts(client_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_period ON payouts(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_source_account ON financial_ledger(source_account);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_created_at ON financial_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_status ON financial_ledger(status);

-- Enable RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_ledger ENABLE ROW LEVEL SECURITY;

-- Create service role policies
CREATE POLICY IF NOT EXISTS "service_role_all_clients" ON clients
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY IF NOT EXISTS "service_role_all_payouts" ON payouts
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY IF NOT EXISTS "service_role_all_financial_ledger" ON financial_ledger
    FOR ALL USING (auth.role() = 'service_role');

-- Test data for Galactic Bytes
INSERT INTO clients (client_name, project_name, email, stripe_customer_id, bank_account_token, payout_schedule, status)
VALUES 
    ('Galactic Bytes', 'galactic-bytes-app', 'finance@galacticbytes.com', 'cus_test_galactic_bytes_001', 'ba_test_galactic_bytes_001', 'monthly', 'active')
ON CONFLICT (email) DO NOTHING;

-- Verify setup
SELECT 'Setup Complete!' as status;
SELECT 'clients' as table_name, count(*) as row_count FROM clients
UNION ALL
SELECT 'payouts' as table_name, count(*) as row_count FROM payouts
UNION ALL
SELECT 'financial_ledger' as table_name, count(*) as row_count FROM financial_ledger;
