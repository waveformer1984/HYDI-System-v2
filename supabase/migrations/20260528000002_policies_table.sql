-- ProtoForge Policy DSL Store
-- Policies are data, not code. ProtoForge loads from here at runtime
-- and subscribes via Supabase Realtime for hot-reload without a deploy.
--
-- Rule schema (jsonb):
-- {
--   "version": "1",
--   "default": "reject",          -- fallback when no rule matches
--   "rules": [
--     {
--       "id": "high-confidence-low-risk",
--       "if": { "confidence": { "gte": 0.85 }, "risk": { "lte": 0.30 } },
--       "then": "approve",
--       "priority": 1
--     },
--     {
--       "id": "budget-auto-approve",
--       "if": { "revenue_impact": { "lte": 100 } },
--       "then": "approve",
--       "priority": 2
--     },
--     {
--       "id": "high-stakes-escalate",
--       "if": { "confidence": { "gte": 0.80 }, "revenue_impact": { "gte": 500 } },
--       "then": "escalate",
--       "priority": 3
--     }
--   ]
-- }

create table if not exists public.policies (
  id            uuid primary key default gen_random_uuid(),
  version       int not null,
  stream        text,            -- null = applies to all streams
  name          text not null,
  description   text,
  rules         jsonb not null,
  author        text not null default 'system',
  is_active     boolean not null default false,
  active_from   timestamptz,
  active_to     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One active policy per stream+version; stream=null is the global baseline
  constraint policies_stream_version_unique unique (stream, version)
);

-- Fast lookup for active policy for a given stream
create index if not exists idx_policies_stream_active
  on public.policies (stream, is_active)
  where is_active = true;

-- Time-window queries (activation schedules)
create index if not exists idx_policies_active_window
  on public.policies (active_from, active_to)
  where is_active = true;

-- Prevent concurrent active policies for the same stream
create unique index if not exists idx_policies_one_active_per_stream
  on public.policies (coalesce(stream, ''))
  where is_active = true;

-- Auto-update updated_at
create or replace function public.policies_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger policies_updated_at
  before update on public.policies
  for each row execute function public.policies_set_updated_at();

-- Seed: global baseline policy (inactive until promoted)
insert into public.policies (version, stream, name, description, rules, author, is_active)
values (
  1,
  null,
  'baseline-v1',
  'Conservative global baseline: approve high-confidence low-risk actions; escalate borderline; reject the rest.',
  '{
    "version": "1",
    "default": "reject",
    "rules": [
      {
        "id": "high-confidence-low-risk",
        "if": { "confidence": { "gte": 0.85 }, "risk": { "lte": 0.30 } },
        "then": "approve",
        "priority": 1
      },
      {
        "id": "budget-auto-approve",
        "if": { "revenue_impact": { "lte": 100 } },
        "then": "approve",
        "priority": 2
      },
      {
        "id": "borderline-escalate",
        "if": { "confidence": { "gte": 0.70 }, "risk": { "lte": 0.50 } },
        "then": "escalate",
        "priority": 3
      }
    ]
  }'::jsonb,
  'system',
  false  -- promote explicitly; never auto-activate seed data
);

-- Enable RLS
alter table public.policies enable row level security;

-- Authenticated users can read active policies (ProtoForge uses service role to write)
create policy "policies_select_active" on public.policies
  for select to authenticated
  using (is_active = true);

-- Service role has full access (policy writes are a privileged operation)
create policy "policies_service_all" on public.policies
  for all to service_role
  using (true)
  with check (true);

-- Grant read to authenticated
grant usage on schema public to authenticated;
grant select on public.policies to authenticated;
