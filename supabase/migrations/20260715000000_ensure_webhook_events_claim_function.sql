-- Ensure webhook_events has what claim_webhook_event() needs, and ensure
-- claim_webhook_event() itself is defined in tracked migration history.
--
-- Both api/webhooks/stripe.js and api/stripe-connect-webhook.js call
-- supabase.rpc('claim_webhook_event', { p_event_id, p_type }) for webhook
-- replay protection. That function, and the webhook_events.event_id column
-- it depends on, were only ever defined in untracked, loose root-level .sql
-- scripts (006_webhook_rpc.sql, webhook-events-table.sql, etc.) -- never in
-- supabase/migrations/. The one tracked migration that does touch
-- webhook_events (20260424152159_hydi_update_webhook_events.sql) drops and
-- rebuilds the table with a different shape (event_type, no event_id, no
-- unique constraint) that claim_webhook_event() cannot work against.
--
-- This migration is purely additive and idempotent -- safe to run on any of:
--   * a fresh database that has only ever seen tracked migrations
--   * a database that separately had the loose scripts applied to it
--   * a database this migration has already been run against before
-- It never drops or renames anything, and never touches event_type or any
-- other pre-existing column.

create table if not exists public.webhook_events (
    id uuid primary key default gen_random_uuid(),
    event_id text,
    type text,
    status text not null default 'processing',
    created_at timestamptz not null default now()
);

alter table public.webhook_events add column if not exists event_id text;
alter table public.webhook_events add column if not exists type text;
alter table public.webhook_events add column if not exists status text not null default 'processing';
alter table public.webhook_events add column if not exists created_at timestamptz not null default now();

-- The tracked-migration shape (20260424152159_hydi_update_webhook_events.sql)
-- has event_type NOT NULL with no default, which claim_webhook_event()'s
-- insert (event_id, type, status) doesn't populate. event_type is superseded
-- by the type column above; only touches it if it exists, and only relaxes
-- the constraint -- never drops the column or touches existing rows.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'webhook_events' and column_name = 'event_type'
  ) then
    alter table public.webhook_events alter column event_type drop not null;
  end if;
end
$$;

-- Required for ON CONFLICT (event_id) in claim_webhook_event() below. A
-- unique index (not a named constraint) so it's creatable with IF NOT
-- EXISTS regardless of what, if anything, already exists on this column.
-- Pre-existing NULL event_id rows (e.g. rows inserted before this column
-- existed on a given database) are unaffected -- Postgres unique indexes
-- treat NULL as distinct from every other NULL.
create unique index if not exists idx_webhook_events_event_id_unique
    on public.webhook_events(event_id);

alter table public.webhook_events enable row level security;

drop policy if exists "webhook_events_service_role" on public.webhook_events;
create policy "webhook_events_service_role" on public.webhook_events
    for all to service_role using (true) with check (true);

create or replace function public.claim_webhook_event(p_event_id text, p_type text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.webhook_events (event_id, type, status)
  values (p_event_id, p_type, 'processing')
  on conflict (event_id) do nothing
  returning id into v_id;

  return v_id; -- null means duplicate/already claimed
end;
$$;

revoke all on function public.claim_webhook_event(text, text) from public;
grant execute on function public.claim_webhook_event(text, text) to service_role;
