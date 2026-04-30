-- Notifications table for notification-service
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  recipient text not null,
  channel text not null check (channel in ('sms', 'email')),
  status text not null check (status in ('pending', 'sent', 'delivered', 'failed')),
  template text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists idx_notifications_recipient on public.notifications(recipient);
create index if not exists idx_notifications_status on public.notifications(status);
create index if not exists idx_notifications_created_at on public.notifications(created_at);
create index if not exists idx_notifications_type on public.notifications(type);

-- Enable RLS
alter table public.notifications enable row level security;

-- RLS policies
create policy "notifications_select_service_role" on public.notifications
for select to service_role
using (true);

create policy "notifications_insert_service_role" on public.notifications
for insert to service_role
with check (true);

create policy "notifications_update_service_role" on public.notifications
for update to service_role
using (true);

-- Grant permissions
grant all on public.notifications to service_role;
grant select on public.notifications to authenticated;

-- Function to get notification stats
create or replace function public.get_notification_stats()
returns table (
  total bigint,
  sent bigint,
  delivered bigint,
  failed bigint,
  sms_count bigint,
  email_count bigint
) as $$
begin
  return query
  select 
    count(*) as total,
    count(*) filter (where status = 'sent') as sent,
    count(*) filter (where status = 'delivered') as delivered,
    count(*) filter (where status = 'failed') as failed,
    count(*) filter (where channel = 'sms') as sms_count,
    count(*) filter (where channel = 'email') as email_count
  from public.notifications;
end;
$$ language plpgsql security definer;

-- Grant permission to stats function
grant execute on function public.get_notification_stats to service_role;
grant execute on function public.get_notification_stats to authenticated;
