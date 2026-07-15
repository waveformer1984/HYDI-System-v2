-- RAW EVENT LEDGER — pipeline layer [2] (see HEIDI_V2_ARCHITECTURE.md)
--
-- Append-only, immutable, hashed single source of truth. Ingestion writes
-- exactly once per event via lib/protoforge/raw-ledger.ts; every other
-- layer (CASCADE, KILO, ProtoForge) only ever reads from it.
--
-- This is the real, persisted replacement for the in-memory
-- modules/raw-event-ledger-v2.js prototype — see
-- HYDI_KERNEL_ARCHITECTURE_ROADMAP.md's Phase 1 for context.

create table if not exists public.raw_event_ledger (
  id            uuid primary key default gen_random_uuid(),
  fingerprint   text not null unique,
  event_type    text not null,
  payload       jsonb not null,
  hash          text not null,
  created_at    timestamptz not null default now()
);

-- Recency queries (replay batches, drift dashboards)
create index if not exists idx_raw_event_ledger_created
  on public.raw_event_ledger (created_at);

-- Filter by classification-ish event_type
create index if not exists idx_raw_event_ledger_event_type
  on public.raw_event_ledger (event_type);

alter table public.raw_event_ledger enable row level security;

-- Append-only at the database layer, not just in application code: only
-- INSERT and SELECT policies exist for service_role. No UPDATE or DELETE
-- policy is created for any role, so RLS denies those operations outright
-- regardless of what application code attempts.
--
-- CREATE POLICY has no IF NOT EXISTS clause in Postgres, so this migration
-- drops-then-recreates to stay idempotent on re-run (matches the pattern
-- already used in 20260707151854_local_baseline_missing_core_objects.sql).
drop policy if exists "raw_event_ledger_service_insert" on public.raw_event_ledger;
create policy "raw_event_ledger_service_insert" on public.raw_event_ledger
  for insert to service_role
  with check (true);

drop policy if exists "raw_event_ledger_service_select" on public.raw_event_ledger;
create policy "raw_event_ledger_service_select" on public.raw_event_ledger
  for select to service_role
  using (true);
