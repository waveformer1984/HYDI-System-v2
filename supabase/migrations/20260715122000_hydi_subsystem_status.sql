-- hydi_subsystem_status — Phase 1 of the mobile-ops build: a single
-- heartbeat table every tracked subsystem writes to, so the status API
-- and SSE stream have one source of truth instead of querying eight
-- different places per request.
--
-- Subsystems tracked (api/heartbeat.js is the ingestion endpoint; a row
-- only exists once something has actually heartbeat-ed, so a subsystem
-- with no code wired up yet — e.g. rave_voice, botforge — correctly
-- reads as "unknown" rather than a fabricated "healthy"):
--   hydi_core, ursula, rave_voice, botforge, worker_fleet, memory, database, deployment
--
-- health_score is written by the caller (api/status/system.js computes
-- it from staleness + reported status, see lib/realtime/healthScore.js);
-- stored here too so historical/offline queries don't need to recompute.
--
-- Additive and idempotent (safe to re-run).

create table if not exists public.hydi_subsystem_status (
  subsystem      text primary key
                   check (subsystem in (
                     'hydi_core', 'ursula', 'rave_voice', 'botforge',
                     'worker_fleet', 'memory', 'database', 'deployment'
                   )),
  status         text not null default 'unknown'
                   check (status in ('healthy', 'degraded', 'critical', 'offline', 'unknown')),
  health_score   integer not null default 0 check (health_score between 0 and 100),
  last_heartbeat timestamptz not null default now(),
  metadata       jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);

alter table public.hydi_subsystem_status enable row level security;

drop policy if exists "hydi_subsystem_status_service_all" on public.hydi_subsystem_status;
create policy "hydi_subsystem_status_service_all" on public.hydi_subsystem_status
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "hydi_subsystem_status_select" on public.hydi_subsystem_status;
create policy "hydi_subsystem_status_select" on public.hydi_subsystem_status
  for select to authenticated using (true);

-- hydi_status_events — audit log of every status transition (Phase 1's
-- "Event audit logging" requirement), separate from the current-state
-- table above so the dashboard's "recent events" list doesn't require
-- diffing snapshots.
create table if not exists public.hydi_status_events (
  id            uuid primary key default gen_random_uuid(),
  subsystem     text not null,
  from_status   text,
  to_status     text not null,
  health_score  integer,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_hydi_status_events_created_at on public.hydi_status_events (created_at desc);
create index if not exists idx_hydi_status_events_subsystem  on public.hydi_status_events (subsystem);

alter table public.hydi_status_events enable row level security;

drop policy if exists "hydi_status_events_service_all" on public.hydi_status_events;
create policy "hydi_status_events_service_all" on public.hydi_status_events
  for all to service_role
  using (true)
  with check (true);
