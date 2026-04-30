-- ========================================
-- UNIFIED ALERT SYSTEM - Infrastructure + Business
-- Run this in Supabase SQL Editor
-- ========================================

-- Drop and recreate with unified alerts
drop function if exists public.get_system_alerts() cascade;

create or replace function public.get_system_alerts()
returns table (
    level text,
    category text, -- 'infrastructure' or 'business'
    metric text,
    message text,
    value text,
    threshold text,
    queue_name text,
    worker_name text,
    customer_id text,
    financial_impact text,
    urgency text
) as $$
begin
    -- ========== INFRASTRUCTURE ALERTS ==========
    
    -- Queue backlog alerts
    return query
    select 
        case 
            when job_count > 50 then 'CRITICAL'
            when job_count > 20 then 'WARNING'
            else 'INFO'
        end,
        'infrastructure',
        'queue_backlog',
        case 
            when job_count > 50 then 'Critical queue backlog'
            when job_count > 20 then 'Elevated queue backlog'
            else 'Queue backlog normal'
        end,
        job_count::text,
        case 
            when job_count > 50 then '> 50 jobs'
            when job_count > 20 then '> 20 jobs'
            else '< 20 jobs'
        end,
        queue_name,
        null,
        null,
        null,
        case 
            when job_count > 50 then 'URGENT'
            when job_count > 20 then 'HIGH'
            else 'NORMAL'
        end
    from public.system_queue_health
    where status = 'queued'
      and job_count > 0;
    
    -- Stalled processing jobs
    return query
    select 
        case 
            when stalled_processing_count > 10 then 'CRITICAL'
            when stalled_processing_count > 0 then 'WARNING'
            else 'INFO'
        end,
        'infrastructure',
        'stalled_jobs',
        case 
            when stalled_processing_count > 10 then 'Many stalled jobs'
            when stalled_processing_count > 0 then 'Stalled jobs detected'
            else 'No stalled jobs'
        end,
        stalled_processing_count::text,
        case 
            when stalled_processing_count > 10 then '> 10 stalled'
            when stalled_processing_count > 0 then '> 0 stalled'
            else '0 stalled'
        end,
        queue_name,
        null,
        null,
        null,
        case 
            when stalled_processing_count > 10 then 'URGENT'
            when stalled_processing_count > 0 then 'HIGH'
            else 'NORMAL'
        end
    from public.system_queue_health
    where stalled_processing_count > 0;
    
    -- Event flow alerts
    return query
    select 
        case 
            when last_event_at is null or last_event_at < now() - interval '30 minutes' then 'CRITICAL'
            when last_event_at < now() - interval '10 minutes' then 'WARNING'
            else 'INFO'
        end,
        'infrastructure',
        'event_flow',
        case 
            when last_event_at is null or last_event_at < now() - interval '30 minutes' then 'No events for 30+ minutes'
            when last_event_at < now() - interval '10 minutes' then 'No events for 10+ minutes'
            else 'Events flowing normally'
        end,
        case 
            when last_event_at is null then 'never'
            else extract(epoch from now() - last_event_at)::text || ' seconds ago'
        end,
        case 
            when last_event_at is null or last_event_at < now() - interval '30 minutes' then '> 30 min'
            when last_event_at < now() - interval '10 minutes' then '> 10 min'
            else '< 10 min'
        end,
        null,
        null,
        null,
        null,
        case 
            when last_event_at is null or last_event_at < now() - interval '30 minutes' then 'URGENT'
            when last_event_at < now() - interval '10 minutes' then 'HIGH'
            else 'NORMAL'
        end
    from public.system_event_flow
    where metric = 'summary';
    
    -- Worker failure rate alerts
    return query
    select 
        case 
            when failure_rate > 0.2 then 'CRITICAL'
            when failure_rate > 0.1 then 'WARNING'
            else 'INFO'
        end,
        'infrastructure',
        'worker_failure_rate',
        case 
            when failure_rate > 0.2 then 'High failure rate'
            when failure_rate > 0.1 then 'Elevated failure rate'
            else 'Failure rate normal'
        end,
        round(failure_rate * 100, 2)::text || '%',
        case 
            when failure_rate > 0.2 then '> 20%'
            when failure_rate > 0.1 then '> 10%'
            else '< 10%'
        end,
        null,
        worker_name,
        null,
        null,
        case 
            when failure_rate > 0.2 then 'URGENT'
            when failure_rate > 0.1 then 'HIGH'
            else 'NORMAL'
        end
    from (
        select 
            worker_name,
            case 
                when (done_24h + failed_24h) = 0 then 0
                else failed_24h::decimal / (done_24h + failed_24h)
            end as failure_rate
        from public.system_worker_performance
        where (done_24h + failed_24h) > 0
    ) t
    where failure_rate > 0.1;
    
    -- Worker heartbeat alerts
    return query
    select 
        case 
            when heartbeat_at is null or heartbeat_at < now() - interval '5 minutes' then 'CRITICAL'
            when heartbeat_at < now() - interval '2 minutes' then 'WARNING'
            else 'INFO'
        end,
        'infrastructure',
        'worker_heartbeat',
        case 
            when heartbeat_at is null then 'Worker never checked in'
            when heartbeat_at < now() - interval '5 minutes' then 'Worker offline >5 min'
            when heartbeat_at < now() - interval '2 minutes' then 'Worker stale >2 min'
            else 'Worker healthy'
        end,
        case 
            when heartbeat_at is null then 'never'
            else extract(epoch from now() - heartbeat_at)::text || ' seconds ago'
        end,
        case 
            when heartbeat_at is null or heartbeat_at < now() - interval '5 minutes' then '> 5 min'
            when heartbeat_at < now() - interval '2 minutes' then '> 2 min'
            else '< 2 min'
        end,
        null,
        worker_name,
        null,
        null,
        case 
            when heartbeat_at is null or heartbeat_at < now() - interval '5 minutes' then 'URGENT'
            when heartbeat_at < now() - interval '2 minutes' then 'HIGH'
            else 'NORMAL'
        end
    from public.system_worker_performance
    where enabled
      and (heartbeat_at is null or heartbeat_at < now() - interval '2 minutes');
    
    -- ========== BUSINESS ALERTS ==========
    
    -- Payment without entitlement
    return query
    select 
        'CRITICAL',
        'business',
        'payment_without_entitlement',
        'Customer paid but no entitlement granted',
        customer_id::text,
        'Should be < 30 seconds',
        null,
        null,
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
        'business',
        'delayed_entitlement',
        'Entitlement granted after delay',
        customer_id::text,
        'Should be < 30 seconds',
        null,
        null,
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
        'business',
        'provisioning_failure',
        'Provisioning failed for paid service',
        customer_id::text,
        'Should be < 60 seconds',
        null,
        null,
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
        'business',
        'revenue_gap',
        'Revenue not tracked correctly',
        'ALL',
        'Gap should be $0.00',
        null,
        null,
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
        'business',
        'duplicate_payment',
        'Possible duplicate payment detected',
        customer_id::text,
        'Should be unique',
        null,
        null,
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

-- Unified dashboard combining both perspectives
create or replace view public.system_unified_dashboard as
with infra as (
    select 
        'infrastructure' as category,
        json_agg(
            json_build_object(
                'metric', 'queue_health',
                'data', (
                    select json_agg(
                        json_build_object(
                            'queue', queue_name,
                            'status', status,
                            'count', job_count,
                            'stalled', stalled_processing_count
                        )
                    )
                    from public.system_queue_health
                )
            )
        ) as data
    from (select 1) t
),
business as (
    select 
        'business' as category,
        json_agg(
            json_build_object(
                'metric', 'payment_entitlement_gaps',
                'critical_count', (select count(*) from public.payment_entitlement_gaps where status = 'NOT_GRANTED'),
                'delayed_count', (select count(*) from public.payment_entitlement_gaps where status = 'DELAYED'),
                'revenue_gap', (select sum(gap_amount) from public.revenue_integrity where integrity_status != 'OK')
            )
        ) as data
    from (select 1) t
)
select * from infra union all select * from business;

-- Convenience queries:

-- 1. All critical alerts (both infra and business)
-- select * from public.get_system_alerts() 
-- where level = 'CRITICAL' 
-- order by urgency desc, category;

-- 2. Only business alerts affecting money
-- select * from public.get_system_alerts() 
-- where category = 'business' and financial_impact is not null
-- order by level desc, financial_impact desc;

-- 3. Only infrastructure issues
-- select * from public.get_system_alerts() 
-- where category = 'infrastructure'
-- order by level desc, urgency desc;

-- 4. Quick summary
-- select category, level, count(*) as alert_count 
-- from public.get_system_alerts() 
-- group by category, level 
-- order by category, level desc;
