-- Rollback: Customer Identity Convergence
-- WARNING: This drops the `customers` table and all `customer_id` columns.
-- Any customer records that were created for subscription-only identities will be lost.
-- Run only if the migration has caused an unrecoverable issue and the previous
-- split-identity state is acceptable.

begin;

-- Drop foreign keys and columns from known commercial tables.
alter table if exists clients drop constraint if exists fk_clients_customer;
alter table if exists clients drop column if exists customer_id;

alter table if exists payouts drop constraint if exists fk_payouts_customer;
alter table if exists payouts drop column if exists customer_id;

alter table if exists hydi_subscriptions drop constraint if exists fk_hydi_subscriptions_customer;
alter table if exists hydi_subscriptions drop column if exists customer_id;

alter table if exists hydi_client_health_runs drop constraint if exists fk_hydi_health_customer;
alter table if exists hydi_client_health_runs drop column if exists customer_id;

alter table if exists hydi_schedules drop constraint if exists fk_hydi_schedules_customer;
alter table if exists hydi_schedules drop column if exists customer_id;

alter table if exists ledger drop column if exists customer_id;

-- Drop FKs and columns for project-motion tables if they exist.
do $$
begin
    if to_regclass('public.leads') is not null then
        alter table leads drop constraint if exists fk_leads_customer;
        alter table leads drop column if exists customer_id;
    end if;
    if to_regclass('public.outreach') is not null then
        alter table outreach drop constraint if exists fk_outreach_customer;
        alter table outreach drop column if exists customer_id;
    end if;
    if to_regclass('public.proposals') is not null then
        alter table proposals drop constraint if exists fk_proposals_customer;
        alter table proposals drop column if exists customer_id;
    end if;
    if to_regclass('public.quotes') is not null then
        alter table quotes drop constraint if exists fk_quotes_customer;
        alter table quotes drop column if exists customer_id;
    end if;
    if to_regclass('public.checkout_sessions') is not null then
        alter table checkout_sessions drop constraint if exists fk_checkout_sessions_customer;
        alter table checkout_sessions drop column if exists customer_id;
    end if;
end $$;

-- Drop the canonical customers table and its policies.
drop policy if exists "service_role_all" on customers;
alter table if exists customers disable row level security;
drop table if exists customers;

commit;
