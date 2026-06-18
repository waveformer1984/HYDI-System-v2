-- Heidi orchestrator schema — tables/columns the autonomous loop expects but that
-- were missing in the live DB. Additive and idempotent (safe to re-run). Fixes:
--   [REVENUE ENGINE] Could not find the table 'public.offers'
--   [MEMORY] Could not find the 'reflection_data' column of 'reflections'

-- 1. offers — HeidiRevenueEngine persists generated offers and reloads active ones.
create table if not exists public.offers (
  id          uuid primary key default gen_random_uuid(),
  offer_id    text not null unique,            -- application-level id (offer.id)
  offer_data  jsonb not null default '{}'::jsonb,
  type        text,
  status      text not null default 'active',  -- active | expired | withdrawn
  created_at  timestamptz not null default now()
);
create index if not exists idx_offers_status   on public.offers (status);
create index if not exists idx_offers_offer_id on public.offers (offer_id);

alter table public.offers enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='offers' and policyname='offers_select') then
    create policy "offers_select" on public.offers for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='offers' and policyname='offers_insert_service') then
    create policy "offers_insert_service" on public.offers for insert to service_role with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='offers' and policyname='offers_update_service') then
    create policy "offers_update_service" on public.offers for update to service_role using (true) with check (true);
  end if;
end $$;

-- 2. reflections — HeidiMemorySystem stores self-reflection snapshots. The table may
--    already exist (RLS migrations referenced it); ensure the written columns exist.
create table if not exists public.reflections (
  id              uuid primary key default gen_random_uuid(),
  reflection_id   text,
  reflection_data jsonb,
  "timestamp"     timestamptz not null default now()
);
alter table public.reflections add column if not exists reflection_id   text;
alter table public.reflections add column if not exists reflection_data jsonb;
alter table public.reflections add column if not exists "timestamp"     timestamptz default now();
create index if not exists idx_reflections_reflection_id on public.reflections (reflection_id);

alter table public.reflections enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reflections' and policyname='reflections_select') then
    create policy "reflections_select" on public.reflections for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reflections' and policyname='reflections_insert_service') then
    create policy "reflections_insert_service" on public.reflections for insert to service_role with check (true);
  end if;
end $$;

grant usage on schema public to authenticated;
grant select on public.offers, public.reflections to authenticated;
