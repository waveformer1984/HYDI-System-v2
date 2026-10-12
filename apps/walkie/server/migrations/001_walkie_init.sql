-- ProtoForge Walkie: channels, membership, invites, blocks and the
-- per-channel speaking-turn lease.
--
-- Lives in its own `walkie` schema so it can share a Postgres (e.g. the
-- local Supabase database) without touching HYDI's public tables. The
-- backend connects with a privileged role; RLS is enabled with no policies,
-- so PostgREST/anon/authenticated clients can read nothing here even if the
-- schema were ever exposed.
--
-- user_id columns hold the Supabase Auth user id (auth.users.id) but carry
-- no foreign key to auth.users, so the schema also runs on plain Postgres
-- (dev auth mode, tests).

create schema if not exists walkie;

create table if not exists walkie.profiles (
  user_id      uuid primary key,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists walkie.channels (
  id         uuid primary key,
  name       text not null check (char_length(name) between 1 and 60),
  owner_id   uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists channels_owner_idx on walkie.channels (owner_id);

create table if not exists walkie.members (
  channel_id uuid not null references walkie.channels (id) on delete cascade,
  user_id    uuid not null,
  role       text not null check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index if not exists members_user_idx on walkie.members (user_id);

create table if not exists walkie.blocks (
  channel_id uuid not null references walkie.channels (id) on delete cascade,
  user_id    uuid not null,
  blocked_by uuid not null,
  blocked_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

-- Only a SHA-256 of the invite code is stored; the code itself is shown to
-- the owner once.
create table if not exists walkie.invites (
  code_hash  text primary key,
  channel_id uuid not null references walkie.channels (id) on delete cascade,
  created_by uuid not null,
  expires_at timestamptz not null,
  max_uses   integer not null check (max_uses > 0),
  uses       integer not null default 0 check (uses >= 0),
  created_at timestamptz not null default now()
);
create index if not exists invites_channel_idx on walkie.invites (channel_id);

-- At most one row per channel == at most one speaker per channel.
-- Deadlines are epoch milliseconds supplied by the backend.
create table if not exists walkie.floor_leases (
  channel_id     uuid primary key references walkie.channels (id) on delete cascade,
  lease_id       uuid not null,
  user_id        uuid not null,
  granted_at     bigint not null,
  renew_deadline bigint not null,
  hard_deadline  bigint not null
);

alter table walkie.profiles     enable row level security;
alter table walkie.channels     enable row level security;
alter table walkie.members      enable row level security;
alter table walkie.blocks       enable row level security;
alter table walkie.invites      enable row level security;
alter table walkie.floor_leases enable row level security;
