-- Milestone 3 (iOS PushToTalk): the ephemeral APNs push token iOS issues for
-- each joined PTT channel. One row per (channel, member). Tokens are not
-- secrets, but they let a holder of APNs credentials wake the device, so they
-- stay server-side (RLS on, no policies) and are deleted with the membership.
create table if not exists walkie.ptt_push_tokens (
  channel_id  uuid not null references walkie.channels (id) on delete cascade,
  user_id     uuid not null,
  token       text not null check (char_length(token) between 16 and 512 and token ~ '^[0-9a-f]+$'),
  environment text not null check (environment in ('sandbox', 'production')),
  updated_at  timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index if not exists ptt_push_tokens_token_idx on walkie.ptt_push_tokens (token);

alter table walkie.ptt_push_tokens enable row level security;
