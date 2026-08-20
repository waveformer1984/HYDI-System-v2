-- HYDI Revenue Engine Schema
-- Introduces canonical tables for the three revenue engines:
--   Engine 1: AI Operations Service (managed service)
--   Engine 2: Lead Generation and Appointment Engine
--   Engine 3: Productized Web + AI Deployment
--
-- These tables extend the existing commercial schema (leads, outreach,
-- proposals, quotes, checkout_sessions, customers, hydi_subscriptions).
-- They do NOT replace existing tables — they add the canonical revenue
-- attribution chain and prospect pipeline.

begin;

-- 1. Revenue Offers — configurable commercial offers
create table if not exists revenue_offers (
    offer_id text primary key,
    name text not null,
    description text,
    category text not null check (category in ('ai_operations', 'website_deployment', 'lead_generation')),
    setup_price integer not null default 0,          -- cents
    recurring_price integer not null default 0,      -- cents
    billing_interval text not null default 'monthly' check (billing_interval in ('one_time', 'monthly', 'annual')),
    included_capabilities text[] default '{}',
    usage_limits jsonb default '{}',
    implementation_requirements text[] default '{}',
    margin_target numeric(3,2) default 0.70,
    upgrade_path text,
    cancellation_behavior text,
    active boolean default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- 2. Revenue Prospects — extends leads with ICP scoring and CRM state
create table if not exists revenue_prospects (
    prospect_id text primary key,
    company_name text not null,
    contact_name text,
    contact_email text,
    contact_phone text,
    website text,
    industry text,
    location text,
    source text not null default 'manual_entry',
    status text not null default 'identified' check (status in (
        'identified', 'researching', 'scored', 'contacted',
        'responded', 'qualified', 'appointment', 'proposal_sent',
        'won', 'lost', 'opted_out'
    )),
    icp_score integer default 0 check (icp_score >= 0 and icp_score <= 100),
    icp_factors jsonb default '{}',
    suppression_list boolean default false,
    opted_out boolean default false,
    last_contacted_at timestamptz,
    next_contact_at timestamptz,
    contact_count integer default 0,
    assigned_to text,
    metadata jsonb default '{}',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Index for deduplication by email or website
create index if not exists idx_revenue_prospects_email on revenue_prospects(contact_email) where contact_email is not null;
create index if not exists idx_revenue_prospects_website on revenue_prospects(website) where website is not null;
create index if not exists idx_revenue_prospects_status on revenue_prospects(status);
create index if not exists idx_revenue_prospects_score on revenue_prospects(icp_score desc);
create index if not exists idx_revenue_prospects_opted_out on revenue_prospects(opted_out) where opted_out = true;

-- 3. Revenue Opportunities — prospect + offer combination
create table if not exists revenue_opportunities (
    opportunity_id text primary key,
    prospect_id text references revenue_prospects(prospect_id),
    offer_id text references revenue_offers(offer_id),
    status text not null default 'open' check (status in ('open', 'proposal_sent', 'accepted', 'rejected', 'expired')),
    proposed_price integer not null default 0,       -- cents
    discount_applied integer default 0,              -- cents
    discount_authorized_by text,
    proposal_id text,
    customer_id text,                                -- references customers(customer_id) when prospect becomes customer
    estimated_value integer default 0,               -- cents (includes recurring)
    probability numeric(3,2) default 0.0,
    expected_close_date date,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_revenue_opportunities_prospect on revenue_opportunities(prospect_id);
create index if not exists idx_revenue_opportunities_status on revenue_opportunities(status);
create index if not exists idx_revenue_opportunities_offer on revenue_opportunities(offer_id);

-- 4. Revenue Ledger — canonical, immutable, auditable
-- A revenue event exists ONLY when backed by a verified payment-provider event.
-- This table is append-only — entries are never modified after insertion.
create table if not exists revenue_ledger (
    ledger_entry_id uuid primary key default gen_random_uuid(),
    event_type text not null check (event_type in (
        'payment_received', 'payment_failed', 'refund_issued',
        'subscription_started', 'subscription_renewed', 'subscription_cancelled',
        'setup_fee_collected', 'chargeback_disputed',
        'payout_initiated', 'payout_completed'
    )),
    source text not null check (source in ('stripe_webhook', 'stripe_connect_webhook', 'manual_entry')),
    stripe_event_id text unique,                    -- for idempotency
    stripe_payment_intent_id text,
    stripe_charge_id text,
    stripe_invoice_id text,
    stripe_subscription_id text,
    customer_id text,                                -- references customers(customer_id)
    prospect_id text,                                -- attribution chain
    opportunity_id text,
    offer_id text,
    amount_gross integer not null default 0,         -- cents
    amount_net integer not null default 0,           -- cents
    currency text not null default 'usd',
    fee_breakdown jsonb default '{}',
    verified boolean not null default false,
    verified_at timestamptz,
    metadata jsonb default '{}',
    recorded_at timestamptz not null default now()
);

create index if not exists idx_revenue_ledger_customer on revenue_ledger(customer_id);
create index if not exists idx_revenue_ledger_event_type on revenue_ledger(event_type);
create index if not exists idx_revenue_ledger_verified on revenue_ledger(verified) where verified = true;
create index if not exists idx_revenue_ledger_stripe_pi on revenue_ledger(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists idx_revenue_ledger_stripe_sub on revenue_ledger(stripe_subscription_id) where stripe_subscription_id is not null;

-- 5. Customer Services — service provisioning and lifecycle
create table if not exists customer_services (
    service_id text primary key,
    customer_id text,                                -- references customers(customer_id)
    offer_id text references revenue_offers(offer_id),
    status text not null default 'pending' check (status in (
        'pending', 'provisioning', 'active', 'degraded',
        'suspended', 'cancelled', 'failed'
    )),
    provisioned_at timestamptz,
    activated_at timestamptz,
    suspended_at timestamptz,
    cancelled_at timestamptz,
    stripe_subscription_id text,
    stripe_customer_id text,
    configuration jsonb default '{}',
    health_check_url text,
    last_health_check_at timestamptz,
    last_health_status text default 'unknown' check (last_health_status in ('healthy', 'degraded', 'unhealthy', 'unknown')),
    fulfillment_steps jsonb default '[]',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_customer_services_customer on customer_services(customer_id);
create index if not exists idx_customer_services_status on customer_services(status);
create index if not exists idx_customer_services_offer on customer_services(offer_id);

-- 6. Revenue Events — commercial interaction audit log
-- Every commercial interaction must be recorded here.
create table if not exists revenue_events (
    event_id uuid primary key default gen_random_uuid(),
    event_type text not null,                        -- e.g. 'prospect_identified', 'outreach_sent', 'response_received'
    prospect_id text,
    customer_id text,
    opportunity_id text,
    offer_id text,
    action_type text,                                -- the RevenueActionType
    action_id text,                                  -- unique action identity
    authorization_mode text,                         -- autonomous, policy_authorized, human_required
    risk_level text,                                 -- R0-R5
    financial_impact integer default 0,              -- cents
    executed boolean default false,
    execution_result text,
    verified boolean default false,
    verification_result text,
    audit_data jsonb default '{}',
    created_at timestamptz not null default now()
);

create index if not exists idx_revenue_events_prospect on revenue_events(prospect_id);
create index if not exists idx_revenue_events_customer on revenue_events(customer_id);
create index if not exists idx_revenue_events_type on revenue_events(event_type);
create index if not exists idx_revenue_events_action on revenue_events(action_id);

-- 7. Suppression List — prospects who have opted out
create table if not exists revenue_suppression_list (
    id uuid primary key default gen_random_uuid(),
    identifier text not null,                        -- email, phone, or domain
    identifier_type text not null check (identifier_type in ('email', 'phone', 'domain')),
    reason text,                                     -- 'opt_out', 'complaint', 'bounce', 'manual'
    prospect_id text,
    created_at timestamptz not null default now(),
    unique(identifier, identifier_type)
);

create index if not exists idx_suppression_identifier on revenue_suppression_list(identifier);

-- 8. ICP Configuration — stored as a single-row config table
create table if not exists revenue_icp_config (
    id integer primary key default 1 check (id = 1),  -- singleton
    config jsonb not null default '{}',
    updated_at timestamptz default now()
);

-- Enable RLS on all new tables
do $$
begin
    begin alter table revenue_offers enable row level security; exception when duplicate_object then null; end;
    begin alter table revenue_prospects enable row level security; exception when duplicate_object then null; end;
    begin alter table revenue_opportunities enable row level security; exception when duplicate_object then null; end;
    begin alter table revenue_ledger enable row level security; exception when duplicate_object then null; end;
    begin alter table customer_services enable row level security; exception when duplicate_object then null; end;
    begin alter table revenue_events enable row level security; exception when duplicate_object then null; end;
    begin alter table revenue_suppression_list enable row level security; exception when duplicate_object then null; end;
    begin alter table revenue_icp_config enable row level security; exception when duplicate_object then null; end;
end $$;

-- Service role policies
do $$
begin
    begin create policy "service_role_all" on revenue_offers for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end;
    begin create policy "service_role_all" on revenue_prospects for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end;
    begin create policy "service_role_all" on revenue_opportunities for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end;
    begin create policy "service_role_all" on revenue_ledger for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end;
    begin create policy "service_role_all" on customer_services for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end;
    begin create policy "service_role_all" on revenue_events for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end;
    begin create policy "service_role_all" on revenue_suppression_list for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end;
    begin create policy "service_role_all" on revenue_icp_config for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end;
end $$;

-- Seed default offers
insert into revenue_offers (offer_id, name, description, category, setup_price, recurring_price, billing_interval, included_capabilities, usage_limits, implementation_requirements, margin_target, upgrade_path, cancellation_behavior, active)
values
    ('ai_operations_setup', 'AI Operations Setup', 'One-time setup of HEIDI AI Business Operations Package', 'ai_operations', 50000, 0, 'one_time',
     array['lead_capture_setup','lead_qualification_config','follow_up_workflow','faq_triage_setup','email_response_assist','operational_monitoring','weekly_performance_report'],
     '{}', array['business_process_discovery_call','crm_or_lead_system_integration','faq_knowledge_base_creation','monitoring_threshold_configuration'],
     0.70, 'ai_operations_monthly', 'Setup fee is non-refundable after work begins.', true),
    ('ai_operations_monthly', 'AI Operations Monthly', 'Monthly managed AI Business Operations service', 'ai_operations', 0, 29900, 'monthly',
     array['inbound_lead_capture','lead_qualification','customer_follow_up','appointment_scheduling','faq_customer_support_triage','email_message_response','business_process_automation','operational_monitoring','weekly_performance_reporting','human_escalation'],
     '{"maxLeadsPerMonth":500,"maxOutreachPerDay":50,"maxAppointmentsPerMonth":100,"maxSupportTicketsPerMonth":200}',
     array['ai_operations_setup_completed'], 0.80, null, 'Cancel anytime. Service continues until end of billing period.', true),
    ('ai_website_setup', 'AI Website + Automation Setup', 'Fixed-scope website deployment with AI chatbot', 'website_deployment', 150000, 0, 'one_time',
     array['business_website_deployment','ai_chatbot_deployment','lead_capture_system','appointment_workflow','contact_crm_integration','analytics_reporting_setup'],
     '{"maxPages":10,"maxChatbotIntents":50}', array['domain_configuration','content_gathering','brand_asset_collection','chatbot_training_data'],
     0.60, 'ai_website_monthly', 'Setup fee is non-refundable after deployment begins.', true),
    ('ai_website_monthly', 'AI Website + Automation Monthly', 'Monthly hosting, monitoring, AI chatbot maintenance', 'website_deployment', 0, 19900, 'monthly',
     array['website_hosting','ai_chatbot_maintenance','analytics_reporting','automation_integration','uptime_monitoring','security_updates'],
     '{"maxBandwidthGb":50,"maxChatbotConversations":1000}', array['ai_website_setup_completed'], 0.75, 'ai_operations_monthly', 'Cancel anytime.', true),
    ('lead_gen_setup', 'Lead Generation Setup', 'One-time setup of autonomous prospecting system', 'lead_generation', 75000, 0, 'one_time',
     array['icp_configuration','prospect_identification','prospect_scoring','outreach_template_creation','compliance_control_setup','suppression_list_setup'],
     '{}', array['icp_definition_call','outreach_channel_authorization','compliance_review'],
     0.65, 'lead_gen_monthly', 'Setup fee is non-refundable after work begins.', true),
    ('lead_gen_monthly', 'Lead Generation Monthly', 'Monthly autonomous prospecting and appointment-setting', 'lead_generation', 0, 49900, 'monthly',
     array['prospect_research','prospect_scoring','outreach_execution','response_tracking','response_classification','prospect_qualification','appointment_scheduling','follow_up_within_policy','conversion_rate_measurement','segment_prioritization'],
     '{"maxNewProspectsPerDay":25,"maxOutreachPerDay":50,"maxAppointmentsPerMonth":30}',
     array['lead_gen_setup_completed'], 0.70, 'ai_operations_monthly', 'Cancel anytime.', true)
on conflict (offer_id) do nothing;

-- Seed default ICP configuration
insert into revenue_icp_config (id, config)
values (1, '{
    "targetIndustries": ["contractor", "repair", "specialty_service", "professional_services", "small_agency", "appointment_based"],
    "businessSizeRange": {"min": 1, "max": 25},
    "revenueRange": {"min": 100000, "max": 5000000},
    "geographicScope": ["US"],
    "requiredPainPoints": ["lead_capture", "response_time", "appointment_scheduling", "customer_communication"],
    "excludeIndustries": ["adult", "gambling", "weapons"],
    "minServiceValue": 29900,
    "scoringWeights": {
        "websiteQuality": 0.15,
        "leadCaptureGap": 0.25,
        "responseTime": 0.20,
        "automationOpportunity": 0.20,
        "businessSize": 0.10,
        "industryFit": 0.10
    }
}')
on conflict (id) do nothing;

commit;

-- Verify
select count(*) as offer_count from revenue_offers;
select count(*) as prospect_count from revenue_prospects;
select count(*) as ledger_count from revenue_ledger;
