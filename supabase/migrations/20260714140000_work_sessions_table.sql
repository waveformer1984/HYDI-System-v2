-- WORK SESSIONS — Phase 4 of HYDI_KERNEL_ARCHITECTURE_ROADMAP.md
--
-- Tracks a stated goal decomposed into an ordered sequence of steps, each
-- one of Heidi's existing action types (create_task, send_email,
-- update_database, fetch_data, schedule_event). Deliberately scoped to
-- the existing action vocabulary -- no new code-editing/test-running/git
-- capability. Steps are executed one at a time via lib/orchestrator.ts's
-- existing gating pipeline (KILO -> ProtoForge -> agent registry); the
-- session pauses (status='failed') on the first failed or ProtoForge-
-- blocked step rather than blindly continuing.

create table if not exists public.work_sessions (
  id            uuid primary key default gen_random_uuid(),
  session_id    text not null,
  user_id       text not null,
  goal          text not null,
  status        text not null default 'planned'
                  check (status in ('planned', 'in_progress', 'completed', 'failed', 'needs_approval')),
  steps         jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists idx_work_sessions_session_id on public.work_sessions (session_id);
create index if not exists idx_work_sessions_status on public.work_sessions (status);

alter table public.work_sessions enable row level security;

-- CREATE POLICY has no IF NOT EXISTS clause in Postgres, so this migration
-- drops-then-recreates to stay idempotent on re-run (matches the pattern
-- already used in 20260707151854_local_baseline_missing_core_objects.sql).
drop policy if exists "work_sessions_service_all" on public.work_sessions;
create policy "work_sessions_service_all" on public.work_sessions
  for all to service_role
  using (true)
  with check (true);

create or replace function public.work_sessions_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- CREATE TRIGGER has no IF NOT EXISTS clause either — same idempotency
-- fix as the policy above.
drop trigger if exists work_sessions_updated_at on public.work_sessions;
create trigger work_sessions_updated_at
  before update on public.work_sessions
  for each row execute function public.work_sessions_set_updated_at();
