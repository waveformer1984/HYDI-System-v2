-- Heidi orchestrator schema — tables/columns the autonomous loop expects but that
-- were missing in the live DB. Additive and idempotent (safe to re-run). Fixes:
--   [REVENUE ENGINE] Could not find the table 'public.offers'
--   [MEMORY] Could not find the 'reflection_data' column of 'reflections' (it's a VIEW)

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

-- 2. heidi_reflection_snapshots — HeidiMemorySystem stores periodic reflection blobs.
--    NOTE: public.reflections is a VIEW in this project (not a table), and the
--    structured public.heidi_reflections table has a different shape. So the memory
--    system writes its { reflection_id, reflection_data, timestamp } snapshots here,
--    avoiding any collision with the existing view.
create table if not exists public.heidi_reflection_snapshots (
  id              uuid primary key default gen_random_uuid(),
  reflection_id   text,
  reflection_data jsonb,
  "timestamp"     timestamptz not null default now()
);
create index if not exists idx_heidi_reflection_snapshots_reflection_id on public.heidi_reflection_snapshots (reflection_id);
create index if not exists idx_heidi_reflection_snapshots_timestamp     on public.heidi_reflection_snapshots ("timestamp" desc);

alter table public.heidi_reflection_snapshots enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='heidi_reflection_snapshots' and policyname='heidi_reflection_snapshots_select') then
    create policy "heidi_reflection_snapshots_select" on public.heidi_reflection_snapshots for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='heidi_reflection_snapshots' and policyname='heidi_reflection_snapshots_insert_service') then
    create policy "heidi_reflection_snapshots_insert_service" on public.heidi_reflection_snapshots for insert to service_role with check (true);
  end if;
end $$;

grant usage on schema public to authenticated;
grant select on public.offers, public.heidi_reflection_snapshots to authenticated;
