create table if not exists payouts (
    payout_id uuid primary key default gen_random_uuid(),
    client_id uuid not null references clients(client_id) on delete cascade,
    period_start date not null,
    period_end date not null,
    gross_earnings numeric not null default 0,
    platform_fee_amount numeric not null default 0,
    agent_fee_amount numeric not null default 0,
    net_payout_amount numeric not null default 0,
    status text not null default 'pending' check (status in ('pending', 'scheduled', 'completed', 'failed')),
    payout_date date,
    stripe_transfer_id text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Indexes for common queries
create index if not exists idx_payouts_client_id on payouts(client_id);
create index if not exists idx_payouts_status on payouts(status);
create index if not exists idx_payouts_period on payouts(period_start, period_end);