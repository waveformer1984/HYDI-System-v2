-- notifications + notification_preferences — Phase 3 of the mobile-ops
-- build. Delivery itself rides the existing public.push_subscriptions
-- table (VAPID web-push registrations, already migrated in
-- 20260623120000_push_subscriptions.sql) via lib/notifications/notify.js;
-- this migration adds the notification *record* (history, read state)
-- and per-device category preferences that were missing.
--
-- Additive and idempotent (safe to re-run).

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  category     text not null
                 check (category in (
                   'worker_failure', 'security_event', 'deployment_failure', 'agent_crash',
                   'task_completed', 'document_generated', 'build_completed', 'deployment_completed',
                   'approval_required', 'destructive_action_confirmation'
                 )),
  severity     text not null default 'info'
                 check (severity in ('critical', 'operational', 'approval', 'info')),
  title        text not null,
  body         text,
  device_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_notifications_created_at on public.notifications (created_at desc);
create index if not exists idx_notifications_unread      on public.notifications (device_id, read_at);
create index if not exists idx_notifications_category    on public.notifications (category);

alter table public.notifications enable row level security;

drop policy if exists "notifications_service_all" on public.notifications;
create policy "notifications_service_all" on public.notifications
  for all to service_role
  using (true)
  with check (true);

-- notification_preferences — one row per device, category->enabled map.
-- Kept as jsonb rather than a category-per-row table since the category
-- set is small, fixed, and always read/written together.
create table if not exists public.notification_preferences (
  device_id   text primary key,
  categories  jsonb not null default '{
    "worker_failure": true, "security_event": true, "deployment_failure": true, "agent_crash": true,
    "task_completed": true, "document_generated": true, "build_completed": true, "deployment_completed": true,
    "approval_required": true, "destructive_action_confirmation": true
  }'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "notification_preferences_service_all" on public.notification_preferences;
create policy "notification_preferences_service_all" on public.notification_preferences
  for all to service_role
  using (true)
  with check (true);
