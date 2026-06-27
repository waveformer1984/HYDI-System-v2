-- push_subscriptions — Heidi web-push persistence (originally the loose
-- setup-push-subscriptions.sql). Tracked here so a fresh deploy reproduces it.
-- Additive and idempotent.

create table if not exists public.push_subscriptions (
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

create index if not exists idx_push_active    on public.push_subscriptions (active);
create index if not exists idx_push_device_id on public.push_subscriptions (device_id);

alter table public.push_subscriptions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='push_subscriptions' and policyname='service_role_all'
  ) then
    create policy "service_role_all" on public.push_subscriptions for all to service_role using (true) with check (true);
  end if;
end $$;
