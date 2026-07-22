-- Ensures agent_control_commands and notifications are broadcast over
-- Supabase Realtime's default `supabase_realtime` publication.
--
-- Why: workers/WorkerOrchestrator.js (the process that executes queued
-- worker commands and creates worker_failure notifications) runs as its own
-- Node process per ecosystem.config.js, not inside the Next.js server that
-- serves api/events/stream.js. Its in-process lib/realtime/eventBus.js
-- publish() calls therefore never reach a phone connected to the SSE
-- stream — only Postgres is shared state both processes actually see.
-- api/events/stream.js's startRealtimeBridge() subscribes to postgres_changes
-- on these two tables and re-emits them onto the SSE stream; this migration
-- is what makes Postgres actually emit those change events in the first
-- place. Without it, the bridge subscribes successfully but never fires.
--
-- Idempotent: guards each ADD TABLE with a pg_publication_tables check
-- since `alter publication ... add table` errors if the table is already a
-- member (e.g. a project where Realtime was enabled for all tables from
-- the dashboard already).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agent_control_commands'
  ) then
    alter publication supabase_realtime add table public.agent_control_commands;
  end if;
exception when undefined_object then
  -- supabase_realtime publication doesn't exist in this environment (e.g. a
  -- bare Postgres instance without the Realtime extension configured) —
  -- api/events/stream.js's startRealtimeBridge() already degrades gracefully
  -- to REST-poll-only when Realtime is unreachable, so skip rather than fail
  -- the whole migration.
  raise notice 'supabase_realtime publication not found; skipping Realtime bridge setup for agent_control_commands';
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication not found; skipping Realtime bridge setup for notifications';
end $$;
