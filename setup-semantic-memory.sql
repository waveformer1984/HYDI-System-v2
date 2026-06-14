-- Heidi semantic memory — cloud-backed facts per device
-- Run this in Supabase SQL editor to upgrade from local JSON storage to Supabase
-- The server currently uses .heidi-memory.json (local file).
-- Once this table exists AND you set SUPABASE_SERVICE_ROLE_KEY, the server
-- will prefer Supabase. (Wire-up migration: future task in heidi-semantic-memory.js)

create table if not exists heidi_memories (
    id          text primary key,
    device_id   text not null,
    content     text not null,
    embedding   jsonb,           -- float array stored as JSON
    source      text default 'chat',
    importance  real default 0.5,
    created_at  timestamptz default now()
);

create index if not exists idx_memories_device on heidi_memories(device_id);
create index if not exists idx_memories_created on heidi_memories(created_at desc);

alter table heidi_memories enable row level security;

create policy "service_role_all" on heidi_memories
    for all to service_role using (true) with check (true);

-- Optional: auto-expire old memories after 90 days
-- (requires pg_cron extension — enable in Supabase Dashboard → Extensions)
-- select cron.schedule('expire-memories', '0 3 * * *',
--     $$delete from heidi_memories where created_at < now() - interval '90 days'$$);
