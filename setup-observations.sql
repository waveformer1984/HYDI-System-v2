-- heidi_observations: persists every agent loop cycle for causal world-model learning
-- Run in Supabase SQL editor. After 30+ cycles, the world model auto-updates every 20 cycles.

create table if not exists heidi_observations (
    id              uuid primary key default gen_random_uuid(),
    cycle           integer not null,
    ts              timestamptz not null,
    forge_status    text,
    forge_build     text,
    services_down   text[] default '{}',
    revenue_24h     float,
    revenue_delta   float,
    decision_action text,
    decision_summary text,
    created_at      timestamptz default now()
);

create index if not exists idx_heidi_obs_ts     on heidi_observations(ts desc);
create index if not exists idx_heidi_obs_cycle  on heidi_observations(cycle);
create index if not exists idx_heidi_obs_forge  on heidi_observations(forge_status) where forge_status is not null;

alter table heidi_observations enable row level security;

create policy "service_role_all" on heidi_observations
    for all to service_role using (true) with check (true);

-- Optional: auto-expire observations older than 90 days (requires pg_cron)
-- select cron.schedule('expire-observations', '0 4 * * *',
--     $$delete from heidi_observations where created_at < now() - interval '90 days'$$);
