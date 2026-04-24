-- ========================================
-- BUSINESS OUTCOME MONITORING
-- Tracks what actually matters: money and user experience
-- Run this in Supabase SQL Editor
-- ========================================

-- 1. Payment-to-entitlement gap detection
create or replace view public.payment_entitlement_gaps as
with payments as (
  -- Recent successful payments
  select 
    stripe_event_id,
    payload->'data'->'object'->'customer' as customer_id,
    payload->'data'->'object'->'amount' as amount,
    created_at,
    payload->'data'->'object'->'metadata'->'product_id' as product_id
  from webhook_events
  where type = 'invoice.payment_succeeded'
    and created_at >= now() - interval '24 hours'
), entitlements as (
  -- Entitlements granted
  select 
    source_event_id,
    customer_id,
    product_id,
    granted_at
  from entitlements
  where granted_at >= now() - interval '24 hours'
)
select 
  p.stripe_event_id,
  p.customer_id,
  p.amount,
  p.created_at as payment_time,
  e.granted_at,
  case 
    when e.granted_at is null then 'NOT_GRANTED'
    when e.granted_at > p.created_at + interval '30 seconds' then 'DELAYED'
    else 'OK'
  end as status,
  extract(epoch from (coalesce(e.granted_at, now()) - p.created_at)) as delay_seconds
from payments p
left join entitlements e on e.source_event_id = p.stripe_event_id
where e.granted_at is null 
   or e.granted_at > p.created_at + interval '30 seconds';

-- 2. Provisioning outcome tracking
create or replace view public.provisioning_outcomes as
with triggers as (
  -- Events that should trigger provisioning
  select 
    id as trigger_id,
    event_id,
    payload->'customer' as customer_id,
    payload->'product' as product_id,
    created_at as trigger_time
  from webhook_events
  where type in ('customer.subscription.created', 'invoice.payment_succeeded')
    and created_at >= now() - interval '24 hours'
), provisions as (
  -- Actual provisioning records
  select 
    source_event_id,
    customer_id,
    service_id,
    status,
    provisioned_at
  from customer_services
  where provisioned_at >= now() - interval '24 hours'
)
select 
  t.trigger_id,
  t.event_id,
  t.customer_id,
  t.product_id,
  t.trigger_time,
  p.status as provision_status,
  p.provisioned_at,
  case 
    when p.provisioned_at is null then 'NOT_PROVISIONED'
    when p.status != 'active' then 'PROVISION_FAILED'
    when p.provisioned_at > t.trigger_time + interval '60 seconds' then 'PROVISION_DELAYED'
    else 'OK'
  end as outcome,
  extract(epoch from (coalesce(p.provisioned_at, now()) - t.trigger_time)) as provisioning_delay_seconds
from triggers t
left join provisions p on p.source_event_id = t.event_id
where p.provisioned_at is null 
   or p.status != 'active'
   or p.provisioned_at > t.trigger_time + interval '60 seconds';

-- 3. Revenue integrity check
create or replace view public.revenue_integrity as
with stripe_revenue as (
  -- What Stripe says you earned
  select 
    date_trunc('day', created_at) as revenue_date,
    sum((payload->'data'->'object'->'amount')::decimal / 100) as stripe_amount
  from webhook_events
  where type = 'invoice.payment_succeeded'
    and created_at >= now() - interval '7 days'
  group by date_trunc('day', created_at)
), tracked_revenue as (
  -- What your system tracked
  select 
    date_trunc('day', created_at) as revenue_date,
    sum(amount) as tracked_amount
  from revenue_tracking
  where created_at >= now() - interval '7 days'
  group by date_trunc('day', created_at)
)
select 
  coalesce(s.revenue_date, t.revenue_date) as date,
  coalesce(s.stripe_amount, 0) as stripe_amount,
  coalesce(t.tracked_amount, 0) as tracked_amount,
  coalesce(s.stripe_amount, 0) - coalesce(t.tracked_amount, 0) as gap_amount,
  case 
    when t.tracked_amount is null then 'NOT_TRACKED'
    when abs(s.stripe_amount - t.tracked_amount) > 0.01 then 'MISMATCH'
    else 'OK'
  end as integrity_status
from stripe_revenue s
full outer join tracked_revenue t on t.revenue_date = s.revenue_date
order by date desc;

-- 4. Business-critical alert function
create or replace function public.get_business_alerts()
returns table (
    level text,
    metric text,
    message text,
    affected_customer text,
    financial_impact text,
    time_to_resolve text
) as $$
begin
    -- Payment without entitlement
    return query
    select 
        'CRITICAL',
        'payment_without_entitlement',
        'Customer paid but no entitlement granted',
        customer_id::text,
        '$' || (amount::decimal / 100)::text,
        case 
            when delay_seconds > 300 then 'URGENT'
            when delay_seconds > 60 then 'HIGH'
            else 'NORMAL'
        end
    from public.payment_entitlement_gaps
    where status = 'NOT_GRANTED';
    
    -- Delayed entitlements
    return query
    select 
        'WARNING',
        'delayed_entitlement',
        'Entitlement granted after delay',
        customer_id::text,
        '$' || (amount::decimal / 100)::text,
        case 
            when delay_seconds > 300 then 'URGENT'
            when delay_seconds > 60 then 'HIGH'
            else 'NORMAL'
        end
    from public.payment_entitlement_gaps
    where status = 'DELAYED';
    
    -- Provisioning failures
    return query
    select 
        'CRITICAL',
        'provisioning_failure',
        'Provisioning failed for paid service',
        customer_id::text,
        product_id::text,
        case 
            when provisioning_delay_seconds > 300 then 'URGENT'
            when provisioning_delay_seconds > 60 else 'HIGH'
        end
    from public.provisioning_outcomes
    where outcome = 'NOT_PROVISIONED' or outcome = 'PROVISION_FAILED';
    
    -- Revenue tracking gaps
    return query
    select 
        'CRITICAL',
        'revenue_gap',
        'Revenue not tracked correctly',
        'ALL',
        '$' || gap_amount::text,
        case 
            when gap_amount > 100 then 'URGENT'
            when gap_amount > 10 then 'HIGH'
            else 'NORMAL'
        end
    from public.revenue_integrity
    where integrity_status = 'MISMATCH' or integrity_status = 'NOT_TRACKED';
    
    -- Duplicate payment detection
    return query
    select 
        'WARNING',
        'duplicate_payment',
        'Possible duplicate payment detected',
        customer_id::text,
        '$' || (amount::decimal / 100)::text,
        'INVESTIGATE'
    from (
        select 
          customer_id,
          amount,
          count(*) as dup_count
        from webhook_events
        where type = 'invoice.payment_succeeded'
          and created_at >= now() - interval '1 hour'
        group by customer_id, amount
        having count(*) > 1
    ) t;
end;
$$ language plpgsql;

-- 5. Executive dashboard
create or replace view public.executive_dashboard as
with metrics as (
  select 
    'payment_success_rate' as metric,
    round(
      (count(*) filter (where type = 'invoice.payment_succeeded')::decimal / 
       nullif(count(*) filter (where type = 'invoice.payment_succeeded' or type = 'invoice.payment_failed'), 0)) * 100, 
      2
    ) as value,
    '%' as unit
  from webhook_events
  where created_at >= now() - interval '24 hours'
  
  union all
  
  select 
    'entitlement_grant_rate' as metric,
    round(
      (count(*) filter (where status = 'OK')::decimal / 
       nullif(count(*), 0)) * 100, 
      2
    ) as value,
    '%' as unit
  from public.payment_entitlement_gaps
  
  union all
  
  select 
    'provisioning_success_rate' as metric,
    round(
      (count(*) filter (where outcome = 'OK')::decimal / 
       nullif(count(*), 0)) * 100, 
      2
    ) as value,
    '%' as unit
  from public.provisioning_outcomes
  
  union all
  
  select 
    'revenue_integrity' as metric,
    count(*) filter (where integrity_status = 'OK')::decimal / 
    nullif(count(*), 0) * 100 as value,
    '%' as unit
  from public.revenue_integrity
  where date >= now() - interval '7 days'
)
select * from metrics where value is not null;

-- Sample queries:

-- 1. Get all business alerts
-- select * from public.get_business_alerts() order by level desc, time_to_resolve;

-- 2. Check payment-to-entitlement gaps
-- select * from public.payment_entitlement_gaps where status != 'OK';

-- 3. Daily revenue integrity
-- select date, stripe_amount, tracked_amount, gap_amount, integrity_status 
-- from public.revenue_integrity 
-- order by date desc limit 7;

-- 4. Executive overview
-- select * from public.executive_dashboard;
