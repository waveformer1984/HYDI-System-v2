-- 🔷 HEIDI DATABASE INITIALIZATION
-- Production-grade conversational AI orchestration system

-- Enable required extension
create extension if not exists vector;

-- MEMORY TABLE
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  session_id text not null,
  content text not null,
  embedding vector(1536),
  created_at timestamp default now()
);

-- ACTION LOG TABLE
create table if not exists actions (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  task_name text,
  status text check (status in ('pending','completed','failed')),
  payload jsonb,
  created_at timestamp default now()
);

-- SESSION STATE TABLE
create table if not exists sessions (
  session_id text primary key,
  tone text,
  active_model text,
  last_action_status text,
  updated_at timestamp default now()
);

-- ROW LEVEL SECURITY
alter table memories enable row level security;
alter table actions enable row level security;
alter table sessions enable row level security;

-- POLICIES (BASIC ISOLATION)
create policy "user_memory_access"
on memories for all
using (auth.uid()::text = user_id);

create policy "session_isolation"
on actions for all
using (true);

create policy "session_state_access"
on sessions for all
using (true);

-- INDEXES for performance
create index if not exists idx_memories_session on memories(session_id);
create index if not exists idx_memories_user on memories(user_id);
create index if not exists idx_memories_created on memories(created_at);

create index if not exists idx_actions_session on actions(session_id);
create index if not exists idx_actions_status on actions(status);
create index if not exists idx_actions_created on actions(created_at);

create index if not exists idx_sessions_updated on sessions(updated_at);

-- VECTOR INDEX for semantic search
create index if not exists idx_memories_embedding on memories using ivfflat (embedding vector_cosine_ops);
