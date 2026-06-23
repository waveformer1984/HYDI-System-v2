-- Simple health check table — minimal schema for PostgREST introspection
-- Used by /api/system/status endpoint to verify database connectivity
-- Isolated from complex migrations that might break PostgREST schema cache

create table if not exists public.health_check (
    id serial primary key,
    status text default 'ok',
    checked_at timestamptz default now()
);

-- Insert a single row for health checks
insert into public.health_check (status) values ('ok') on conflict do nothing;

-- Enable RLS and allow service role
alter table public.health_check enable row level security;
drop policy if exists "service_role_all" on public.health_check;
create policy "service_role_all" on public.health_check
    for all
    to service_role
    using (true)
    with check (true);

-- Comment: This table is intentionally simple to avoid triggering PostgREST
-- schema introspection issues that may exist in the main schema.
-- It serves as a canary for database connectivity without querying complex tables.
