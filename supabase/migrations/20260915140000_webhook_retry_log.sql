-- webhook_retry_log: tracks bounded retries for failed webhooks.
--
-- The FailedWebhookDetector retries each failed webhook ONCE, then
-- escalates persistent failures. This table records which webhooks
-- have already consumed their retry, so the detector doesn't retry
-- indefinitely.
--
-- One row per retry attempt (currently bounded to 1 per webhook).

create table if not exists public.webhook_retry_log (
    id          uuid primary key default gen_random_uuid(),
    webhook_id  uuid not null,
    retried_at  timestamptz not null default now(),
    created_at  timestamptz not null default now()
);

create index if not exists idx_webhook_retry_log_webhook_id
    on public.webhook_retry_log(webhook_id);

alter table public.webhook_retry_log enable row level security;

-- Server-side only (SUPABASE_SERVICE_ROLE_KEY)
drop policy if exists "webhook_retry_log_service_all" on public.webhook_retry_log;
create policy "webhook_retry_log_service_all" on public.webhook_retry_log
    for all
    to service_role
    using (true)
    with check (true);
