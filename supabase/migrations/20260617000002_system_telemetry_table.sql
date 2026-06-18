-- system_telemetry — the Universal Agent Bus batch-inserts sampled telemetry here
-- (modules/universal-agent-bus.js -> flushTelemetry / logTelemetry). The table was
-- missing in the live DB, so every flush returned PostgREST 404. Because failed
-- batches are re-buffered and retried (see flushTelemetry catch block), this produced
-- a relentless stream of `POST /rest/v1/system_telemetry -> 404` in the logs.
--
-- Column types match the entry object built in logTelemetry():
--   priority is a small int (SYSTEM=0..ENTERPRISE=3); ttl/elapsed_ms are ms.
-- Additive and idempotent (safe to re-run).

create table if not exists public.system_telemetry (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null,
  message_id      text,
  origin          text,
  target          text,
  action          text,
  customer_id     text,
  subscription_id text,
  tier            text,
  priority        integer,
  ttl             bigint,
  elapsed_ms      bigint,
  error_message   text,
  metadata        jsonb not null default '{}'::jsonb,
  sampled         boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Indexes for the retention sweep and the dashboard query
-- (getDashboardTelemetry filters by customer_id/subscription_id over a created_at window).
create index if not exists idx_system_telemetry_created_at    on public.system_telemetry (created_at desc);
create index if not exists idx_system_telemetry_event_type    on public.system_telemetry (event_type);
create index if not exists idx_system_telemetry_customer      on public.system_telemetry (customer_id);
create index if not exists idx_system_telemetry_subscription  on public.system_telemetry (subscription_id);

alter table public.system_telemetry enable row level security;

-- Writes come from the server (service role); reads allowed for authenticated dashboards.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'system_telemetry' and policyname = 'service_role_all'
  ) then
    create policy "service_role_all" on public.system_telemetry
      for all to service_role using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'system_telemetry' and policyname = 'system_telemetry_select'
  ) then
    create policy "system_telemetry_select" on public.system_telemetry
      for select to authenticated using (true);
  end if;
end $$;
