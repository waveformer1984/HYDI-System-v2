-- Chat Operator Schema Migration
-- Core tables for chat operator functionality

-- Conversations table
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  title text,
  status text default 'active' check (status in ('active', 'closed', 'escalated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Messages table
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'assistant', 'system')),
  content text not null,
  tool_call jsonb,
  created_at timestamptz not null default now()
);

-- Action log (auditable "did stuff" history)
create table if not exists public.operator_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  requested_by uuid not null,
  action_name text not null,
  action_input jsonb not null default '{}'::jsonb,
  action_status text not null check (action_status in ('queued', 'running', 'success', 'failed')),
  action_output jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists idx_chat_conversations_owner_user_id on public.chat_conversations(owner_user_id);
create index if not exists idx_chat_messages_conversation_created_at on public.chat_messages(conversation_id, created_at);
create index if not exists idx_operator_actions_conversation_created_at on public.operator_actions(conversation_id, created_at);
create index if not exists idx_operator_actions_status on public.operator_actions(action_status);

-- Enable RLS on all tables
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.operator_actions enable row level security;

-- Conversations policies
create policy "conv_select_own" on public.chat_conversations
for select to authenticated
using ((select auth.uid()) = owner_user_id);

create policy "conv_insert_own" on public.chat_conversations
for insert to authenticated
with check ((select auth.uid()) = owner_user_id);

-- Messages policies
create policy "msg_select_own_conv" on public.chat_messages
for select to authenticated
using (
  exists (
    select 1
    from public.chat_conversations c
    where c.id = conversation_id
      and c.owner_user_id = (select auth.uid())
  )
);

create policy "msg_insert_own_conv" on public.chat_messages
for insert to authenticated
with check (
  exists (
    select 1
    from public.chat_conversations c
    where c.id = conversation_id
      and c.owner_user_id = (select auth.uid())
  )
);

-- Actions policies
create policy "act_select_own_conv" on public.operator_actions
for select to authenticated
using (
  exists (
    select 1
    from public.chat_conversations c
    where c.id = conversation_id
      and c.owner_user_id = (select auth.uid())
  )
);

create policy "act_insert_own" on public.operator_actions
for insert to authenticated
with check (requested_by = (select auth.uid()));

-- Create publication for Realtime
drop publication if exists chat_events;
create publication chat_events for table public.chat_messages, public.operator_actions;

-- Grant permissions to authenticated users
grant usage on schema public to authenticated;
grant select on public.chat_conversations to authenticated;
grant select on public.chat_messages to authenticated;
grant select on public.operator_actions to authenticated;
grant insert on public.chat_conversations to authenticated;
grant insert on public.chat_messages to authenticated;
grant insert on public.operator_actions to authenticated;
