-- Stores determinism replay results produced by ReplayEngine.persistResult()
create table if not exists replay_history (
  id              uuid        primary key default gen_random_uuid(),
  event_id        text        not null,
  drift_detected  boolean     not null default false,
  drift_fields    jsonb       not null default '[]',
  original_output jsonb       not null default '{}',
  replay_output   jsonb       not null default '{}',
  replayed_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists replay_history_event_id_idx
  on replay_history (event_id);

create index if not exists replay_history_drift_idx
  on replay_history (drift_detected)
  where drift_detected = true;

create index if not exists replay_history_replayed_at_idx
  on replay_history (replayed_at desc);
