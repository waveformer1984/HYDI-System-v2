-- Phase 6 (mobile-ops build) "Memory and Intelligence Foundation" —
-- search/tagging/importance/expiration/audit history.
--
-- HYDI_KERNEL_ARCHITECTURE_ROADMAP.md's non-goals are explicit: "No new
-- memory store — extend memories/sessions, don't add a fourth." The
-- `memories` table (pgvector-backed) is already the centralized store
-- used by lib/heidi-memory.ts and lib/episodic-memory.ts, and already has
-- a `kind` discriminator (20260714130000) distinguishing conversation vs
-- episodic rows. This migration extends the same table rather than
-- forking a new one, matching that migration's own pattern.
--
-- Additive and idempotent (safe to re-run).

alter table public.memories add column if not exists tags text[] not null default '{}';
alter table public.memories add column if not exists importance_score numeric not null default 0.5
  check (importance_score >= 0 and importance_score <= 1);
alter table public.memories add column if not exists expires_at timestamptz;
alter table public.memories add column if not exists last_accessed_at timestamptz;

create index if not exists idx_memories_tags             on public.memories using gin (tags);
create index if not exists idx_memories_importance_score on public.memories (importance_score desc);
create index if not exists idx_memories_expires_at       on public.memories (expires_at);

-- memory_audit_log — records reads (search hits) and writes touching
-- important/expiring memories, per Phase 6's "Audit history" requirement.
-- Deliberately not logging every single read (would drown the table);
-- api/memory/search.js logs one row per search call with the matched ids.
create table if not exists public.memory_audit_log (
  id           uuid primary key default gen_random_uuid(),
  action       text not null check (action in ('search', 'store', 'tag', 'expire', 'delete')),
  memory_id    uuid,
  actor        text,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_memory_audit_log_created_at on public.memory_audit_log (created_at desc);
create index if not exists idx_memory_audit_log_memory_id  on public.memory_audit_log (memory_id);

alter table public.memory_audit_log enable row level security;

drop policy if exists "memory_audit_log_service_all" on public.memory_audit_log;
create policy "memory_audit_log_service_all" on public.memory_audit_log
  for all to service_role
  using (true)
  with check (true);

-- Expiration sweep — used by a scheduled job (or run ad hoc via RPC) to
-- delete memories past expires_at. Not scheduled by this migration
-- (no pg_cron entry added here); wiring a cron trigger is left as an
-- explicit follow-up, see docs/MOBILE_OPERATIONS.md's tech-debt list.
create or replace function public.expire_stale_memories()
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  with deleted as (
    delete from public.memories
    where expires_at is not null and expires_at < now()
    returning id
  )
  select count(*) into v_count from deleted;

  insert into public.memory_audit_log (action, detail)
  values ('expire', jsonb_build_object('count', v_count));

  return v_count;
end;
$$;
