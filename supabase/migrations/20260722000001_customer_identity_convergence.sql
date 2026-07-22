-- Customer Identity Convergence
-- Introduces a canonical `customers` table and adds `customer_id` UUID foreign keys
-- to every commercial table. Legacy `client_id` columns are preserved for backward
-- compatibility.

begin;

-- 1. Canonical customer table
 create table if not exists customers (
    customer_id uuid primary key default gen_random_uuid(),
    name text not null,
    email text unique not null,
    stripe_customer_id text unique,
    status text not null default 'active' check (status in ('active','inactive','suspended')),
    metadata jsonb default '{}',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- 2. Seed customers from the existing project-motion clients table
insert into customers (customer_id, name, email, stripe_customer_id, status, created_at, updated_at)
select
    client_id,
    client_name,
    email,
    stripe_customer_id,
    status,
    created_at,
    updated_at
from clients
on conflict (customer_id) do nothing;

-- 3. Add customer_id columns to all commercial tables
alter table clients add column if not exists customer_id uuid;
alter table payouts add column if not exists customer_id uuid;
alter table hydi_subscriptions add column if not exists customer_id uuid;
alter table hydi_client_health_runs add column if not exists customer_id uuid;
alter table hydi_schedules add column if not exists customer_id uuid;
alter table ledger add column if not exists customer_id uuid;

-- Project-motion tables are created in a different schema path; guard with to_regclass.
do $$
begin
    if to_regclass('public.leads') is not null then
        alter table leads add column if not exists customer_id uuid;
    end if;
    if to_regclass('public.outreach') is not null then
        alter table outreach add column if not exists customer_id uuid;
    end if;
    if to_regclass('public.proposals') is not null then
        alter table proposals add column if not exists customer_id uuid;
    end if;
    if to_regclass('public.quotes') is not null then
        alter table quotes add column if not exists customer_id uuid;
    end if;
    if to_regclass('public.checkout_sessions') is not null then
        alter table checkout_sessions add column if not exists customer_id uuid;
    end if;
end $$;

-- 4. Populate known customer_id relationships
-- Project clients are themselves customers.
update clients set customer_id = client_id where customer_id is null;

-- Payouts reference project clients.
update payouts set customer_id = client_id where customer_id is null;

-- Subscriptions that already match a project client by UUID text.
update hydi_subscriptions hs
set customer_id = c.customer_id
from customers c
where hs.customer_id is null
  and hs.client_id::uuid = c.customer_id;

-- Subscriptions that match by Stripe customer ID.
update hydi_subscriptions hs
set customer_id = c.customer_id
from customers c
where hs.customer_id is null
  and c.stripe_customer_id is not null
  and hs.stripe_customer_id = c.stripe_customer_id;

-- Subscriptions that match by email.
update hydi_subscriptions hs
set customer_id = c.customer_id
from customers c
where hs.customer_id is null
  and hs.client_email = c.email;

-- 5. Create new customers for any remaining subscription-only identities.
--    This ensures every commercial row resolves to a single canonical customer.
do $$
declare
    rec record;
    matched_customer_id uuid;
    fallback_email text;
begin
    for rec in
        select id, client_id, client_email, client_company, stripe_customer_id
        from hydi_subscriptions
        where customer_id is null
    loop
        matched_customer_id := null;

        -- Attempt UUID match, catching non-UUID text values such as Stripe IDs.
        begin
            select customer_id into matched_customer_id
            from customers
            where customer_id = rec.client_id::uuid
            limit 1;
        exception when invalid_text_representation then
            matched_customer_id := null;
        end;

        -- Stripe customer ID match.
        if matched_customer_id is null and rec.stripe_customer_id is not null then
            select customer_id into matched_customer_id
            from customers
            where stripe_customer_id = rec.stripe_customer_id
            limit 1;
        end if;

        -- Email match.
        if matched_customer_id is null and rec.client_email is not null then
            select customer_id into matched_customer_id
            from customers
            where email = rec.client_email
            limit 1;
        end if;

        -- Create a new customer if no match found.
        if matched_customer_id is null then
            fallback_email := coalesce(
                rec.client_email,
                'unknown+' || rec.id::text || '@local'
            );

            insert into customers (name, email, stripe_customer_id, status)
            values (rec.client_company, fallback_email, rec.stripe_customer_id, 'active')
            returning customer_id into matched_customer_id;
        end if;

        update hydi_subscriptions
        set customer_id = matched_customer_id
        where id = rec.id;
    end loop;
end $$;

-- 6. Derive customer_id for health runs and schedules from subscriptions.
update hydi_client_health_runs h
set customer_id = s.customer_id
from hydi_subscriptions s
where h.customer_id is null
  and h.subscription_id = s.id;

update hydi_schedules h
set customer_id = s.customer_id
from hydi_subscriptions s
where h.customer_id is null
  and h.subscription_id = s.id;

-- 7. Foreign keys: tables that are guaranteed to exist in this migration path.
alter table clients add constraint if not exists fk_clients_customer
    foreign key (customer_id) references customers(customer_id);
alter table payouts add constraint if not exists fk_payouts_customer
    foreign key (customer_id) references customers(customer_id);
alter table hydi_subscriptions add constraint if not exists fk_hydi_subscriptions_customer
    foreign key (customer_id) references customers(customer_id);
alter table hydi_client_health_runs add constraint if not exists fk_hydi_health_customer
    foreign key (customer_id) references customers(customer_id);
alter table hydi_schedules add constraint if not exists fk_hydi_schedules_customer
    foreign key (customer_id) references customers(customer_id);

-- Ledger is renamed in a later phase; keep customer_id nullable here so events can populate it.
-- Do not add a FK until the financial ledger migration backfills or validates rows.

-- 8. Foreign keys for project-motion tables, guarded by existence.
do $$
begin
    if to_regclass('public.leads') is not null then
        alter table leads add constraint if not exists fk_leads_customer
            foreign key (customer_id) references customers(customer_id);
    end if;
    if to_regclass('public.outreach') is not null then
        alter table outreach add constraint if not exists fk_outreach_customer
            foreign key (customer_id) references customers(customer_id);
    end if;
    if to_regclass('public.proposals') is not null then
        alter table proposals add constraint if not exists fk_proposals_customer
            foreign key (customer_id) references customers(customer_id);
    end if;
    if to_regclass('public.quotes') is not null then
        alter table quotes add constraint if not exists fk_quotes_customer
            foreign key (customer_id) references customers(customer_id);
    end if;
    if to_regclass('public.checkout_sessions') is not null then
        alter table checkout_sessions add constraint if not exists fk_checkout_sessions_customer
            foreign key (customer_id) references customers(customer_id);
    end if;
end $$;

-- 9. Indexes on the new customer_id columns.
create index if not exists idx_customers_email on customers(email);
create index if not exists idx_customers_stripe_customer on customers(stripe_customer_id);
create index if not exists idx_clients_customer_id on clients(customer_id);
create index if not exists idx_payouts_customer_id on payouts(customer_id);
create index if not exists idx_hydi_subscriptions_customer_id on hydi_subscriptions(customer_id);
create index if not exists idx_hydi_health_customer_id on hydi_client_health_runs(customer_id);
create index if not exists idx_hydi_schedules_customer_id on hydi_schedules(customer_id);

-- 10. RLS on customers (service_role only, matching other commercial tables).
alter table customers enable row level security;

do $$
begin
    create policy "service_role_all" on customers
        for all using (auth.role() = 'service_role');
exception
    when duplicate_object then null;
end $$;

commit;
