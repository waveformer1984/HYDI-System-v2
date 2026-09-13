-- operational_boundary: defines the go-live timestamp that separates
-- test/qualification data from real production data.
--
-- The RevenueReconciliationDetector, FailedWebhookDetector, and
-- StuckJobDetector all respect this boundary: any record created
-- before the go_live_at timestamp is excluded from detection cycles.
--
-- This prevents test data from qualification runs from polluting
-- operational detector findings. When the system actually goes live,
-- set go_live_at to the real go-live timestamp.
--
-- Until go-live, the boundary is set to 'now' — meaning all existing
-- data is treated as pre-go-live (test) data, and only data created
-- after the boundary is inserted will be checked by the detectors.
--
-- To update the go-live timestamp:
--   UPDATE operational_boundary SET go_live_at = '2026-09-01T00:00:00Z' WHERE id = 1;

create table if not exists public.operational_boundary (
    id          integer primary key default 1,
    go_live_at  timestamptz not null default now(),
    note        text,
    updated_at  timestamptz not null default now(),
    constraint single_row CHECK (id = 1)
);

-- Insert the default row (go_live_at = now, meaning all existing data is pre-boundary)
insert into public.operational_boundary (id, go_live_at, note)
values (1, now(), 'Initial boundary: all existing data is pre-go-live (test/qualification data). Update go_live_at when the system actually goes live.')
on conflict (id) do nothing;

alter table public.operational_boundary enable row level security;

-- Server-side only (SUPABASE_SERVICE_ROLE_KEY)
drop policy if exists "operational_boundary_service_all" on public.operational_boundary;
create policy "operational_boundary_service_all" on public.operational_boundary
    for all
    to service_role
    using (true)
    with check (true);
