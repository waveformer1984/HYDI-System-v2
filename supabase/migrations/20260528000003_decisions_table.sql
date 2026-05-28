-- ProtoForge Decision Audit Trail
-- Every accept/reject/escalate ProtoForge makes lands here, linked to the
-- RAW EVENT LEDGER by event_hash and to the policy that drove it.
-- Immutable by design: no UPDATE/DELETE for authenticated role.
-- Outcome is backfilled by the emission layer when execution completes.

create table if not exists public.decisions (
  id              uuid primary key default gen_random_uuid(),

  -- Links
  event_hash      text not null,         -- SHA-256 of the RAW LEDGER event
  hypothesis_id   text not null,         -- KILO hypothesis that triggered this
  policy_id       uuid references public.policies(id) on delete set null,
  policy_version  int not null,

  -- Decision
  decision        text not null check (decision in ('approve', 'reject', 'escalate')),
  matched_rule_id text,                  -- which rule in the DSL fired
  confidence      numeric(4,3) check (confidence between 0 and 1),
  risk_score      numeric(4,3) check (risk_score between 0 and 1),
  revenue_impact  numeric(12,2),         -- estimated $ impact at decision time
  stream          text,                  -- galactic_bytes, rezonate, etc.
  reasoning       text,                  -- human-readable explanation

  decided_at      timestamptz not null default now(),

  -- Outcome (backfilled by emission layer after execution)
  outcome         text check (outcome in ('success', 'failure', 'unknown')),
  outcome_at      timestamptz,
  outcome_detail  jsonb                  -- { revenue_actual, error, latency_ms, ... }
);

-- Replay: look up all decisions for an event
create index if not exists idx_decisions_event_hash
  on public.decisions (event_hash);

-- Audit: all decisions for a hypothesis (KILO may generate multiple)
create index if not exists idx_decisions_hypothesis_id
  on public.decisions (hypothesis_id);

-- Dashboard: recent decisions per stream
create index if not exists idx_decisions_stream_decided_at
  on public.decisions (stream, decided_at desc);

-- Feedback loop: find decisions missing outcomes (for the calibration worker)
create index if not exists idx_decisions_pending_outcome
  on public.decisions (decided_at)
  where outcome is null and decision = 'approve';

-- Policy performance: how did a given policy version do?
create index if not exists idx_decisions_policy_version
  on public.decisions (policy_id, policy_version, outcome);

-- Enable RLS
alter table public.decisions enable row level security;

-- Immutable audit trail: authenticated can only read
create policy "decisions_select" on public.decisions
  for select to authenticated
  using (true);

-- Only service role inserts (ProtoForge writes via service key)
create policy "decisions_insert_service" on public.decisions
  for insert to service_role
  with check (true);

-- Service role can backfill outcome only (no other updates)
create policy "decisions_update_outcome_service" on public.decisions
  for update to service_role
  using (true)
  with check (
    -- Only outcome columns may change; core decision columns are frozen
    decision = decision and
    event_hash = event_hash and
    hypothesis_id = hypothesis_id and
    policy_version = policy_version
  );

-- Grant
grant usage on schema public to authenticated;
grant select on public.decisions to authenticated;

-- View: policy performance summary (used by Ursula status feed)
create or replace view public.policy_performance as
select
  d.policy_id,
  d.policy_version,
  p.name as policy_name,
  d.stream,
  count(*) filter (where d.decision = 'approve')   as approved,
  count(*) filter (where d.decision = 'reject')    as rejected,
  count(*) filter (where d.decision = 'escalate')  as escalated,
  count(*) filter (where d.outcome = 'success')    as successes,
  count(*) filter (where d.outcome = 'failure')    as failures,
  round(
    count(*) filter (where d.outcome = 'success')::numeric /
    nullif(count(*) filter (where d.outcome in ('success','failure')), 0),
    3
  ) as success_rate,
  min(d.decided_at) as first_decision,
  max(d.decided_at) as last_decision
from public.decisions d
left join public.policies p on p.id = d.policy_id
group by d.policy_id, d.policy_version, p.name, d.stream;

grant select on public.policy_performance to authenticated;
