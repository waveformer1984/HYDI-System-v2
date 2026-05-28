-- Heidi chat session persistence
-- Run once in Supabase SQL Editor (or any Postgres connected to your project)

create table if not exists heidi_chat_sessions (
    id          uuid        default gen_random_uuid() primary key,
    device_id   text        not null unique,
    messages    jsonb       not null default '[]',
    model       text,
    msg_count   integer     default 0,
    updated_at  timestamptz default now(),
    created_at  timestamptz default now()
);

alter table heidi_chat_sessions enable row level security;

-- No public access — server uses service_role key which bypasses RLS
create policy "no_public_access" on heidi_chat_sessions
    for all to anon using (false);

create index if not exists heidi_chat_sessions_device_id_idx
    on heidi_chat_sessions(device_id);
