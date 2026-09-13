-- HYDI Revenue Job Schema
-- Connects payment → job → execution → delivery → revenue ledger
--
-- This is the missing link between the existing revenue infrastructure
-- (StripeBridge, RevenueLedger, CustomerLifecycle) and HEIDI's governed
-- execution (HumanActionEngine, GoalStateMachine).
--
-- The customer_jobs table is the persistent record of a paid customer
-- request that HEIDI executes through the governed path.

begin;

-- 1. Customer Jobs — the core job model connecting payment to execution
create table if not exists customer_jobs (
    job_id text primary key,
    customer_id text,                           -- references customers or revenue_prospects
    customer_email text not null,
    customer_name text,
    product text not null,                      -- e.g. 'protoforge_model_prep'
    request_text text not null,                 -- customer's description of what they want
    requirements jsonb default '{}',            -- structured requirements (dimensions, material, etc.)
    price_cents integer not null default 0,     -- total price in cents
    currency text not null default 'usd',

    -- Payment state
    payment_status text not null default 'unpaid' check (payment_status in (
        'unpaid', 'pending', 'paid', 'failed', 'refunded'
    )),
    stripe_checkout_session_id text,
    stripe_payment_intent_id text,
    stripe_event_id text,                       -- the webhook event that confirmed payment
    paid_at timestamptz,

    -- Job lifecycle
    job_status text not null default 'created' check (job_status in (
        'created',           -- job record created, awaiting payment
        'queued',            -- payment confirmed, waiting for HEIDI pickup
        'executing',         -- HEIDI is working on it
        'awaiting_review',   -- artifact produced, waiting for human approval
        'delivered',         -- artifact delivered to customer
        'failed',            -- execution failed
        'cancelled',         -- customer cancelled
        'refunded'           -- payment refunded
    )),

    -- Execution state
    execution_status text default 'pending' check (execution_status in (
        'pending', 'running', 'completed', 'failed'
    )),
    execution_started_at timestamptz,
    execution_completed_at timestamptz,
    execution_error text,

    -- Intervention state
    intervention_status text default 'none' check (intervention_status in (
        'none', 'requested', 'approved', 'rejected', 'resolved'
    )),
    intervention_id text,

    -- Verification state
    verification_status text default 'pending' check (verification_status in (
        'pending', 'verified', 'failed'
    )),
    verification_notes text,

    -- Artifact references
    artifact_paths text[] default '{}',         -- file paths to produced artifacts
    artifact_metadata jsonb default '{}',       -- metadata about artifacts (sizes, hashes, etc.)

    -- Delivery state
    delivery_status text default 'pending' check (delivery_status in (
        'pending', 'delivered', 'failed'
    )),
    delivered_at timestamptz,
    delivery_token text,                        -- unique token for customer download access

    -- Revenue ledger link
    ledger_entry_id uuid,                       -- references revenue_ledger.ledger_entry_id

    -- Audit
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_customer_jobs_email on customer_jobs(customer_email);
create index if not exists idx_customer_jobs_status on customer_jobs(job_status);
create index if not exists idx_customer_jobs_payment on customer_jobs(payment_status);
create index if not exists idx_customer_jobs_stripe_session on customer_jobs(stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index if not exists idx_customer_jobs_stripe_event on customer_jobs(stripe_event_id) where stripe_event_id is not null;

-- 2. Job events — audit trail for every job state transition
create table if not exists customer_job_events (
    event_id uuid primary key default gen_random_uuid(),
    job_id text not null references customer_jobs(job_id),
    event_type text not null,                   -- 'job_created', 'payment_confirmed', 'execution_started', etc.
    actor text,                                 -- 'heidi', 'human', 'system', 'stripe_webhook'
    from_state text,
    to_state text,
    details jsonb default '{}',
    created_at timestamptz not null default now()
);

create index if not exists idx_customer_job_events_job on customer_job_events(job_id);
create index if not exists idx_customer_job_events_type on customer_job_events(event_type);

-- Enable RLS
do $$
begin
    begin alter table customer_jobs enable row level security; exception when duplicate_object then null; end;
    begin alter table customer_job_events enable row level security; exception when duplicate_object then null; end;
end $$;

-- Service role policies
do $$
begin
    begin create policy "service_role_all" on customer_jobs for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end;
    begin create policy "service_role_all" on customer_job_events for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end;
end $$;

-- Add the new product to revenue_offers
insert into revenue_offers (offer_id, name, description, category, setup_price, recurring_price, billing_interval, included_capabilities, usage_limits, implementation_requirements, margin_target, upgrade_path, cancellation_behavior, active)
values (
    'protoforge_model_prep',
    '3D-Printable Model Preparation Package',
    'Send us a description of a simple object. We produce a parameterized OpenSCAD source file, a print-ready STL mesh, and a specification document. Delivered as a downloadable package.',
    'ai_operations',
    2900,       -- $29.00 in cents
    0,
    'one_time',
    array['model_generation', 'stl_export', 'documentation'],
    '{"maxParts": 1, "maxDimensions": "100x100x100mm"}',
    array['object_description', 'preferred_dimensions'],
    0.85,
    null,
    'Full refund if artifact generation fails. One free revision if artifact does not match description.',
    true
) on conflict (offer_id) do nothing;

commit;

-- Verification
do $$
declare
    job_count integer;
    event_count integer;
    offer_count integer;
begin
    select count(*) into job_count from information_schema.tables where table_name = 'customer_jobs';
    select count(*) into event_count from information_schema.tables where table_name = 'customer_job_events';
    select count(*) into offer_count from revenue_offers where offer_id = 'protoforge_model_prep';
    raise notice 'customer_jobs table: %', job_count;
    raise notice 'customer_job_events table: %', event_count;
    raise notice 'protoforge_model_prep offer: %', offer_count;
end $$;
