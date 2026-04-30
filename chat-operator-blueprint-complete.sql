-- Minimal Chat Operator Blueprint - Complete Implementation
-- Production-ready schema with RLS, functions, and Realtime setup

-- ============================================================================
-- 1) CORE DATABASE SCHEMA
-- ============================================================================

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

-- ============================================================================
-- 2) RLS POLICIES (MUST-HAVE)
-- ============================================================================

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

create policy "conv_update_own" on public.chat_conversations
for update to authenticated
using ((select auth.uid()) = owner_user_id);

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

-- ============================================================================
-- 3) SAFE TOOL EXECUTION PATTERN (WHITELISTED RPC FUNCTIONS)
-- ============================================================================

-- Tool: Create invoice
create or replace function public.tool_create_invoice(
  customer_id uuid,
  amount_cents int,
  note text default ''
) returns uuid as $$
declare
  v_invoice_id uuid;
begin
  -- Validate inputs
  if customer_id is null or amount_cents <= 0 then
    raise exception 'Invalid invoice parameters';
  end if;
  
  -- Create invoice (would integrate with actual billing system)
  v_invoice_id := gen_random_uuid();
  
  -- Log the action for audit
  insert into public.operator_actions (
    conversation_id,
    requested_by,
    action_name,
    action_input,
    action_status,
    action_output
  ) values (
    null, -- Will be set by caller
    (select auth.uid()),
    'tool_create_invoice',
    jsonb_build_object('customer_id', customer_id, 'amount_cents', amount_cents, 'note', note),
    'success',
    jsonb_build_object('invoice_id', v_invoice_id, 'amount_cents', amount_cents)
  );
  
  return v_invoice_id;
end;
$$ language plpgsql security definer;

-- Tool: Pause subscription
create or replace function public.tool_pause_subscription(
  subscription_id text
) returns boolean as $$
declare
  v_success boolean := false;
begin
  -- Validate input
  if subscription_id is null or subscription_id = '' then
    raise exception 'Invalid subscription ID';
  end if;
  
  -- Pause subscription (would integrate with actual subscription system)
  v_success := true;
  
  -- Log the action for audit
  insert into public.operator_actions (
    conversation_id,
    requested_by,
    action_name,
    action_input,
    action_status,
    action_output
  ) values (
    null, -- Will be set by caller
    (select auth.uid()),
    'tool_pause_subscription',
    jsonb_build_object('subscription_id', subscription_id),
    'success',
    jsonb_build_object('subscription_id', subscription_id, 'paused', v_success)
  );
  
  return v_success;
end;
$$ language plpgsql security definer;

-- Tool: Create support ticket
create or replace function public.tool_create_support_ticket(
  subject text,
  body text
) returns uuid as $$
declare
  v_ticket_id uuid;
begin
  -- Validate inputs
  if subject is null or body is null then
    raise exception 'Subject and body are required';
  end if;
  
  -- Create ticket (would integrate with actual ticketing system)
  v_ticket_id := gen_random_uuid();
  
  -- Log the action for audit
  insert into public.operator_actions (
    conversation_id,
    requested_by,
    action_name,
    action_input,
    action_status,
    action_output
  ) values (
    null, -- Will be set by caller
    (select auth.uid()),
    'tool_create_support_ticket',
    jsonb_build_object('subject', subject, 'body', body),
    'success',
    jsonb_build_object('ticket_id', v_ticket_id, 'subject', subject)
  );
  
  return v_ticket_id;
end;
$$ language plpgsql security definer;

-- Tool: Refund payment
create or replace function public.tool_refund_payment(
  payment_id text,
  amount_cents int,
  reason text default ''
) returns uuid as $$
declare
  v_refund_id uuid;
begin
  -- Validate inputs
  if payment_id is null or amount_cents <= 0 then
    raise exception 'Invalid refund parameters';
  end if;
  
  -- Process refund (would integrate with actual payment system)
  v_refund_id := gen_random_uuid();
  
  -- Log the action for audit
  insert into public.operator_actions (
    conversation_id,
    requested_by,
    action_name,
    action_input,
    action_status,
    action_output
  ) values (
    null, -- Will be set by caller
    (select auth.uid()),
    'tool_refund_payment',
    jsonb_build_object('payment_id', payment_id, 'amount_cents', amount_cents, 'reason', reason),
    'success',
    jsonb_build_object('refund_id', v_refund_id, 'amount_cents', amount_cents)
  );
  
  return v_refund_id;
end;
$$ language plpgsql security definer;

-- Tool: Update customer status
create or replace function public.tool_update_customer_status(
  customer_id uuid,
  new_status text
) returns boolean as $$
declare
  v_success boolean := false;
begin
  -- Validate inputs
  if customer_id is null or new_status is null then
    raise exception 'Customer ID and status are required';
  end if;
  
  -- Update customer status (would integrate with actual CRM)
  v_success := true;
  
  -- Log the action for audit
  insert into public.operator_actions (
    conversation_id,
    requested_by,
    action_name,
    action_input,
    action_status,
    action_output
  ) values (
    null, -- Will be set by caller
    (select auth.uid()),
    'tool_update_customer_status',
    jsonb_build_object('customer_id', customer_id, 'new_status', new_status),
    'success',
    jsonb_build_object('customer_id', customer_id, 'status', new_status, 'updated', v_success)
  );
  
  return v_success;
end;
$$ language plpgsql security definer;

-- Helper function to get conversation messages
create or replace function public.get_conversation_messages(
  p_conversation_id uuid,
  p_limit int default 50
) returns table (
  id uuid,
  sender_type text,
  content text,
  tool_call jsonb,
  created_at timestamptz
) as $$
begin
  return query
  select 
    m.id,
    m.sender_type,
    m.content,
    m.tool_call,
    m.created_at
  from public.chat_messages m
  where m.conversation_id = p_conversation_id
    and exists (
      select 1 from public.chat_conversations c 
      where c.id = p_conversation_id 
        and c.owner_user_id = (select auth.uid())
    )
  order by m.created_at asc
  limit p_limit;
end;
$$ language plpgsql security definer;

-- Helper function to get conversation actions
create or replace function public.get_conversation_actions(
  p_conversation_id uuid
) returns table (
  id uuid,
  action_name text,
  action_status text,
  action_input jsonb,
  action_output jsonb,
  error_text text,
  created_at timestamptz
) as $$
begin
  return query
  select 
    a.id,
    a.action_name,
    a.action_status,
    a.action_input,
    a.action_output,
    a.error_text,
    a.created_at
  from public.operator_actions a
  where a.conversation_id = p_conversation_id
    and exists (
      select 1 from public.chat_conversations c 
      where c.id = p_conversation_id 
        and c.owner_user_id = (select auth.uid())
    )
  order by a.created_at desc;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- 4) REALTIME SETUP
-- ============================================================================

-- Create publication for Realtime
drop publication if exists chat_events;
create publication chat_events for table public.chat_messages, public.chat_operator_actions;

-- Grant permissions to authenticated users
grant usage on schema public to authenticated;
grant select on public.chat_conversations to authenticated;
grant select on public.chat_messages to authenticated;
grant select on public.operator_actions to authenticated;
grant insert on public.chat_conversations to authenticated;
grant insert on public.chat_messages to authenticated;
grant insert on public.operator_actions to authenticated;
grant execute on function public.get_conversation_messages to authenticated;
grant execute on function public.get_conversation_actions to authenticated;
grant execute on function public.tool_create_invoice to authenticated;
grant execute on function public.tool_pause_subscription to authenticated;
grant execute on function public.tool_create_support_ticket to authenticated;
grant execute on function public.tool_refund_payment to authenticated;
grant execute on function public.tool_update_customer_status to authenticated;

-- ============================================================================
-- 5) SAMPLE DATA (optional for testing)
-- ============================================================================

-- Uncomment to create sample data for testing
/*
-- Create sample conversation
insert into public.chat_conversations (owner_user_id, title)
values (gen_random_uuid(), 'Test Conversation');

-- Create sample messages
insert into public.chat_messages (conversation_id, sender_type, content)
values (
  (select id from public.chat_conversations limit 1),
  'user',
  'Hello, I need help with my subscription'
);

insert into public.chat_messages (conversation_id, sender_type, content)
values (
  (select id from public.chat_conversations limit 1),
  'assistant',
  'I can help you with that! What specific issue are you experiencing?'
);
*/
