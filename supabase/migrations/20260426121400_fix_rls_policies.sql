-- Fix RLS policies to allow service role operations
-- Add service role permissions for system operations

-- Grant additional permissions to service role
grant insert on public.chat_conversations to service_role;
grant insert on public.chat_messages to service_role;
grant insert on public.operator_actions to service_role;
grant update on public.operator_actions to service_role;
grant select on public.chat_conversations to service_role;
grant select on public.chat_messages to service_role;
grant select on public.operator_actions to service_role;

-- Add service role bypass for RLS
alter table public.chat_conversations force row level security;
alter table public.chat_messages force row level security;
alter table public.operator_actions force row level security;

-- Create policies for service role
create policy "service_role_all" on public.chat_conversations
for all to service_role
using (true)
with check (true);

create policy "service_role_all" on public.chat_messages
for all to service_role
using (true)
with check (true);

create policy "service_role_all" on public.operator_actions
for all to service_role
using (true)
with check (true);
