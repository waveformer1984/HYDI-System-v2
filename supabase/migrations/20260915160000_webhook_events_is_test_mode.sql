-- Add is_test_mode column to webhook_events and backfill known test-mode records.
--
-- The FailedWebhookDetector excludes test-mode webhooks from its findings.
-- Previously, exclusion relied on:
--   1. evt_test_ prefix in event_id (synthetic test events)
--   2. cs_test_ in payload (test-mode checkout sessions)
--   3. getStripeMode().mode === 'test' (system running with sk_test_)
--
-- Condition 3 is a runtime check that breaks at go-live: the moment sk_live_
-- is configured, those 7 real Stripe test-mode events (evt_3U8YL*, evt_1U8YL*
-- with empty payloads) would resurface as "stale webhooks" on the first
-- post-go-live run.
--
-- This migration adds a persisted is_test_mode boolean column and backfills
-- it true for the 7 specific records that are identifiable as test-mode
-- only by the runtime system-mode check (real Stripe event IDs, empty
-- payloads, created during test-mode qualification runs).
--
-- Going forward, the claim_webhook_event() RPC and WebhookQueueAdapter
-- stamp is_test_mode at insert time based on the system's Stripe mode,
-- so every future record is self-describing.

-- 1. Add the column (nullable boolean, defaults to null for old rows)
alter table public.webhook_events
    add column if not exists is_test_mode boolean;

-- 2. Backfill: mark the 7 known test-mode records that have real Stripe event IDs
--    and empty payloads. These are the records that can only be identified as
--    test-mode by the runtime system-mode check. Their event IDs match the
--    pattern evt_[0-9]+[A-Za-z0-9]+ (real Stripe event IDs, not evt_test_).
--    We identify them as: status='processing', event_id NOT LIKE 'evt_test_%',
--    and payload is empty/null/{}.
update public.webhook_events
set is_test_mode = true
where status = 'processing'
  and event_id is not null
  and event_id not like 'evt_test_%'
  and (
    payload is null
    or payload::text = '{}'::text
    or payload::text = 'null'::text
  );

-- 3. Backfill: also mark any evt_test_* records (synthetic test events)
update public.webhook_events
set is_test_mode = true
where event_id like 'evt_test_%'
  and is_test_mode is null;

-- 4. Backfill: also mark records whose payload contains cs_test_
update public.webhook_events
set is_test_mode = true
where payload::text like '%cs_test_%'
  and is_test_mode is null;

-- 5. Update the claim_webhook_event() function to stamp is_test_mode at
--    insert time. The function now accepts an optional p_is_test_mode
--    parameter. Callers should pass getStripeMode().mode === 'test'.
--    For backward compatibility, if the parameter is not passed, it
--    defaults to null (unknown — the detector will fall back to other checks).
create or replace function public.claim_webhook_event(
    p_event_id text,
    p_type text,
    p_is_test_mode boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.webhook_events (event_id, type, status, is_test_mode)
  values (p_event_id, p_type, 'processing', p_is_test_mode)
  on conflict (event_id) do nothing
  returning id into v_id;

  return v_id; -- null means duplicate/already claimed
end;
$$;

revoke all on function public.claim_webhook_event(text, text, boolean) from public;
grant execute on function public.claim_webhook_event(text, text, boolean) to service_role;

-- Drop the old 2-arg version if it exists (it's superseded by the 3-arg version)
drop function if exists public.claim_webhook_event(text, text);
