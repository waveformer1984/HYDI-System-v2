create table if not exists clients (
    client_id uuid primary key default gen_random_uuid(),
    client_name text not null,
    project_name text not null,
    stripe_customer_id text unique,
    bank_account_token text,
    email text unique not null,
    payout_schedule text not null default 'monthly' check (payout_schedule in ('monthly', 'custom')),
    status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Indexes
create index if not exists idx_clients_email on clients(email);
create index if not exists idx_clients_stripe_customer on clients(stripe_customer_id);