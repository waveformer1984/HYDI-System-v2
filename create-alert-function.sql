-- ========================================
-- ALERT FUNCTION - Ties all monitoring together
-- Run this in Supabase SQL Editor
-- ========================================

create or replace function public.get_system_alerts()
returns table (
    level text,
    metric text,
    message text,
    value text,
    threshold text,
    queue_name text,
    worker_name text
) as $$
begin
    -- Queue backlog alerts
    return query
    select 
        case 
            when job_count > 50 then 'CRITICAL'
            when job_count > 20 then 'WARNING'
            else 'INFO'
        end,
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
        null
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
        null
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
        null
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
        worker_name
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
        worker_name
    from public.system_worker_performance
    where enabled
      and (heartbeat_at is null or heartbeat_at < now() - interval '2 minutes');
end;
$$ language plpgsql;

-- Quick dashboard query
create or replace view public.system_dashboard as
select 
    'queue_health' as section,
    json_agg(
        json_build_object(
            'queue', queue_name,
            'status', status,
            'count', job_count,
            'oldest', oldest_job_at,
            'stalled', stalled_processing_count
        )
    ) as data
from public.system_queue_health

union all

select 
    'event_flow' as section,
    json_agg(
        json_build_object(
            'metric', metric,
            'dimension', dimension,
            'events_5m', events_5m,
            'events_1h', events_1h,
            'events_24h', events_24h,
            'last_event', last_event_at
        )
    ) as data
from public.system_event_flow

union all

select 
    'worker_performance' as section,
    json_agg(
        json_build_object(
            'worker', worker_name,
            'enabled', enabled,
            'ecosystem', ecosystem,
            'done_24h', done_24h,
            'failed_24h', failed_24h,
            'avg_seconds', avg_completion_seconds_24h,
            'heartbeat', heartbeat_at
        )
    ) as data
from public.system_worker_performance;

-- Sample queries to run:

-- 1. Get all active alerts
-- select * from public.get_system_alerts() where level in ('CRITICAL', 'WARNING');

-- 2. Quick system overview
-- select * from public.system_dashboard;

-- 3. Queue health summary
-- select queue_name, status, sum(job_count) as total from public.system_queue_health group by queue_name, status order by queue_name, status;
