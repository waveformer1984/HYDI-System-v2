-- agent_control_commands — the worker-lifecycle command queue for mobile
-- operations. CLAUDE.md / the mobile-ops task brief claimed this table
-- and the api/agent-manager/control.js endpoint already existed; neither
-- did (verified 2026-07-15: zero references anywhere in the repo). This
-- migration builds the real thing.
--
-- Flow: api/agent-manager/control.js (RBAC + HMAC gated) inserts a row
-- here with status='pending' -> workers/WorkerOrchestrator.js polls
-- pending rows, executes the lifecycle action against its in-memory
-- worker map, and writes the result back (status + result + completed_at).
-- Every row is also mirrored into auth_audit_log by the API layer so
-- "who asked for what" survives independently of command outcome.
--
-- Additive and idempotent (safe to re-run).

create table if not exists public.agent_control_commands (
  id             uuid primary key default gen_random_uuid(),
  worker_type    text not null,
  worker_id      text,
  command        text not null
                   check (command in ('start', 'stop', 'restart', 'scale_up', 'scale_down')),
  status         text not null default 'pending'
                   check (status in ('pending', 'processing', 'completed', 'failed', 'rejected')),
  requested_by   text not null,
  requested_role text,
  payload        jsonb not null default '{}'::jsonb,
  result         jsonb,
  error_message  text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz
);

create index if not exists idx_agent_control_commands_status
  on public.agent_control_commands (status, created_at);
create index if not exists idx_agent_control_commands_worker_type
  on public.agent_control_commands (worker_type);

alter table public.agent_control_commands enable row level security;

drop policy if exists "agent_control_commands_service_all" on public.agent_control_commands;
create policy "agent_control_commands_service_all" on public.agent_control_commands
  for all to service_role
  using (true)
  with check (true);
