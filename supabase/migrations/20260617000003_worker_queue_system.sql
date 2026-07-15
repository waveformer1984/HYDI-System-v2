-- Worker queue system — the native-Postgres queue the worker fleet relies on
-- (action-worker / agent-worker / tool-executor and friends). Every worker was
-- failing because worker_status / worker_queues / worker_events did not exist.
--
-- This is the NON-PARTITIONED form (the version applied to the live DB). The
-- original loose SQL used hash partitioning on queue_name, which fails on
-- Postgres: a partitioned table's PRIMARY KEY must contain the partition key, and
-- id alone does not include queue_name. At this scale partitioning buys nothing,
-- so we drop it. Uses the built-in gen_random_uuid() (pgcrypto) instead of the
-- uuid-ossp generator, to avoid an extra extension dependency.
-- Additive and idempotent.

create table if not exists public.worker_queues (
  id            uuid primary key default gen_random_uuid(),
  queue_name    text not null,
  payload       jsonb not null,
  status        text default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  priority      integer default 0 check (priority >= 0 and priority <= 10),
  attempts      integer default 0,
  max_attempts  integer default 3,
  error_message text,
  created_at    timestamptz default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

create table if not exists public.worker_status (
  worker_id       text primary key,
  worker_type     text not null,
  status          text default 'idle' check (status in ('idle', 'busy', 'error', 'stopped')),
  last_heartbeat  timestamptz default now(),
  current_task_id uuid references public.worker_queues(id),
  processed_count integer default 0,
  error_count     integer default 0,
  metadata        jsonb default '{}'::jsonb
);

create table if not exists public.worker_events (
  id          uuid primary key default gen_random_uuid(),
  worker_id   text,
  queue_name  text,
  event_type  text not null,
  task_id     uuid,
  details     jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

create index if not exists idx_worker_queues_status      on public.worker_queues (status, queue_name);
create index if not exists idx_worker_queues_priority    on public.worker_queues (priority desc, created_at);
create index if not exists idx_worker_queues_name_status on public.worker_queues (queue_name, status);
create index if not exists idx_worker_status_heartbeat   on public.worker_status (last_heartbeat);

alter table public.worker_queues enable row level security;
alter table public.worker_status enable row level security;
alter table public.worker_events enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='worker_queues' and policyname='service_role_all') then
    create policy "service_role_all" on public.worker_queues for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='worker_status' and policyname='service_role_all') then
    create policy "service_role_all" on public.worker_status for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='worker_events' and policyname='service_role_all') then
    create policy "service_role_all" on public.worker_events for all to service_role using (true) with check (true);
  end if;
end $$;

-- ── Queue operations ──────────────────────────────────────────────────────────

create or replace function public.enqueue_task(
  p_queue_name   text,
  p_payload      jsonb,
  p_priority     integer default 0,
  p_max_attempts integer default 3
) returns uuid as $$
declare
  v_task_id uuid;
begin
  insert into public.worker_queues (queue_name, payload, priority, max_attempts)
  values (p_queue_name, p_payload, p_priority, p_max_attempts)
  returning id into v_task_id;

  insert into public.worker_events (queue_name, event_type, task_id, details)
  values (p_queue_name, 'enqueued', v_task_id, jsonb_build_object('priority', p_priority));

  return v_task_id;
end;
$$ language plpgsql;

create or replace function public.dequeue_task(
  p_queue_name text,
  p_worker_id  text
) returns uuid as $$
declare
  v_task_id uuid;
begin
  update public.worker_status
     set last_heartbeat = now(), status = 'busy'
   where worker_id = p_worker_id;

  update public.worker_queues
     set status = 'processing',
         attempts = attempts + 1,
         started_at = now()
   where id = (
     select id from public.worker_queues
      where queue_name = p_queue_name
        and status = 'pending'
        and attempts < max_attempts
      order by priority desc, created_at asc
      limit 1
      for update skip locked
   )
   returning id into v_task_id;

  if v_task_id is not null then
    update public.worker_status
       set current_task_id = v_task_id, processed_count = processed_count + 1
     where worker_id = p_worker_id;

    insert into public.worker_events (worker_id, queue_name, event_type, task_id)
    values (p_worker_id, p_queue_name, 'dequeued', v_task_id);
  end if;

  return v_task_id;
end;
$$ language plpgsql;

create or replace function public.complete_task(
  p_task_id       uuid,
  p_worker_id     text,
  p_success       boolean default true,
  p_error_message text default null
) returns void as $$
declare
  v_queue_name text;
begin
  -- renamed local var (was queue_name, which shadowed the column and made the
  -- SELECT ... INTO target ambiguous)
  select queue_name into v_queue_name from public.worker_queues where id = p_task_id;

  if p_success then
    update public.worker_queues
       set status = 'completed', completed_at = now()
     where id = p_task_id;

    insert into public.worker_events (worker_id, queue_name, event_type, task_id)
    values (p_worker_id, v_queue_name, 'completed', p_task_id);
  else
    update public.worker_queues
       set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
           error_message = p_error_message,
           completed_at = case when attempts >= max_attempts then now() else null end
     where id = p_task_id;

    update public.worker_status
       set error_count = error_count + 1
     where worker_id = p_worker_id;

    insert into public.worker_events (worker_id, queue_name, event_type, task_id, details)
    values (p_worker_id, v_queue_name,
            case when (select attempts >= max_attempts from public.worker_queues where id = p_task_id) then 'failed' else 'retry' end,
            p_task_id,
            jsonb_build_object('error', p_error_message));
  end if;

  update public.worker_status
     set current_task_id = null, status = 'idle'
   where worker_id = p_worker_id;
end;
$$ language plpgsql;

create or replace function public.cleanup_old_tasks() returns void as $$
begin
  delete from public.worker_queues
   where status in ('completed', 'failed')
     and completed_at < now() - interval '7 days';
end;
$$ language plpgsql;

-- Optional scheduled cleanup (requires pg_cron):
-- select cron.schedule('cleanup-worker-tasks', '0 2 * * *', 'select public.cleanup_old_tasks();');
