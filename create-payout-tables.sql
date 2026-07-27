-- Create clients table for ProtoForge payouts
CREATE TABLE IF NOT EXISTS public.clients (
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

-- Create payouts table for ProtoForge
CREATE TABLE IF NOT EXISTS public.payouts (
    payout_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL references public.clients(client_id) on delete cascade,
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
CREATE TABLE IF NOT EXISTS public.financial_ledger (
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

-- Indexes for clients table
CREATE INDEX IF NOT EXISTS idx_clients_email ON public.clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_stripe_customer ON public.clients(stripe_customer_id);

-- Indexes for payouts table
CREATE INDEX IF NOT EXISTS idx_payouts_client_id ON public.payouts(client_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON public.payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_period ON public.payouts(period_start, period_end);

-- Indexes for financial_ledger table
CREATE INDEX IF NOT EXISTS idx_financial_ledger_source_account ON public.financial_ledger(source_account);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_created_at ON public.financial_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_status ON public.financial_ledger(status);

-- Enable RLS
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;

-- Create policies for service role
CREATE POLICY "service_role_all" ON public.clients
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON public.payouts
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON public.financial_ledger
    FOR ALL USING (auth.role() = 'service_role');

-- Verify tables were created
SELECT 'clients' as table_name, count(*) as row_count FROM public.clients
UNION ALL
SELECT 'payouts' as table_name, count(*) as row_count FROM public.payouts
UNION ALL
SELECT 'financial_ledger' as table_name, count(*) as row_count FROM public.financial_ledger;
