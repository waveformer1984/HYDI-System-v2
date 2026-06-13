-- push_subscriptions table for Heidi web push persistence
-- Run this in Supabase SQL editor or via supabase db query

create table if not exists push_subscriptions (
    id          uuid primary key default gen_random_uuid(),
    device_id   text not null,
    endpoint    text not null unique,
    p256dh      text not null,
    auth        text not null,
    device_name text,
    active      boolean default true,
    created_at  timestamptz default now(),
    updated_at  timestamptz default now()
);

create index if not exists idx_push_active    on push_subscriptions(active);
create index if not exists idx_push_device_id on push_subscriptions(device_id);

-- RLS
alter table push_subscriptions enable row level security;

-- Service role has full access (server-side only via SUPABASE_SERVICE_ROLE_KEY)
create policy "service_role_all" on push_subscriptions
    for all
    to service_role
    using (true)
    with check (true);
