-- Agent/worker remote-control command queue.
--
-- Mobile ops needs a way to start/stop/restart a worker fleet from the API
-- layer, but WorkerOrchestrator (workers/WorkerOrchestrator.js) is a
-- long-lived Node process, not something a Vercel serverless function can
-- call into directly. So control requests are written here as commands;
-- the running orchestrator polls and executes them, then records the
-- outcome back onto the same row. This table doubles as the audit log for
-- who requested what and when (least-privilege: only start/stop/restart are
-- representable, nothing arbitrary).
--
-- Additive and idempotent, matches supabase/migrations/20260617000003_worker_queue_system.sql
-- conventions (gen_random_uuid, service_role-only RLS policy).

create table if not exists public.agent_control_commands (
  id             uuid primary key default gen_random_uuid(),
  worker_type    text not null,
  command        text not null check (command in ('start', 'stop', 'restart')),
  status         text not null default 'pending' check (status in ('pending', 'acknowledged', 'completed', 'failed')),
  requested_by   text not null,
  reason         text,
  result_message text,
  created_at     timestamptz not null default now(),
  processed_at   timestamptz
);

create index if not exists idx_agent_control_commands_status
  on public.agent_control_commands (status, created_at);
create index if not exists idx_agent_control_commands_worker_type
  on public.agent_control_commands (worker_type, created_at desc);

alter table public.agent_control_commands enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'agent_control_commands'
       and policyname = 'service_role_all'
  ) then
    create policy "service_role_all" on public.agent_control_commands
      for all to service_role using (true) with check (true);
  end if;
end $$;
