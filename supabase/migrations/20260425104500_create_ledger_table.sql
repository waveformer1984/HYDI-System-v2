create table if not exists ledger (
    transaction_id uuid primary key default gen_random_uuid(),
    timestamp timestamptz default now(),
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

-- Indexes for common queries
create index if not exists idx_ledger_source_account on ledger(source_account);
create index if not exists idx_ledger_timestamp on ledger(timestamp);
create index if not exists idx_ledger_status on ledger(status);