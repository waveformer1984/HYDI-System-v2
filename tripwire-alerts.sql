-- ========================================
-- TRIPWIRE ALERT SYSTEM
-- Run this to create monitoring views and alerts
-- ========================================

-- 1. Queue health monitor with thresholds
create or replace view system_queue_health as
select 
    'queue_health' as metric,
    (select count(*)::text from worker_jobs where status = 'queued') as queued_jobs,
    case 
        when (select count(*) from worker_jobs where status = 'queued') > 50 then '🚨 CRITICAL'
        when (select count(*) from worker_jobs where status = 'queued') > 20 then '⚠️ WARNING'
        else '✅ OK'
    end as queue_status,
    (select count(*)::text from worker_jobs where status = 'failed') as failed_jobs,
    case 
        when (select count(*) from worker_jobs where status = 'failed') > 10 then '🚨 CRITICAL'
        when (select count(*) from worker_jobs where status = 'failed') > 5 then '⚠️ WARNING'
        else '✅ OK'
    end as failed_status,
    (select count(*)::text from worker_jobs where status = 'processing') as processing_jobs,
    case 
        when (select count(*) from worker_jobs where status = 'processing') > 30 then '🚨 STUCK'
        when (select count(*) from worker_jobs where status = 'processing') > 10 then '⚠️ BUSY'
        else '✅ OK'
    end as processing_status;

-- 2. Event flow monitor
create or replace view system_event_flow as
select 
    'event_flow' as metric,
    (select count(*)::text from event_bus_events where created_at >= now() - interval '1 hour') as events_last_hour,
    case 
        when (select count(*) from event_bus_events where created_at >= now() - interval '1 hour') = 0 then '🚨 NO EVENTS'
        when (select count(*) from event_bus_events where created_at >= now() - interval '1 hour') < 10 then '⚠️ LOW ACTIVITY'
        else '✅ ACTIVE'
    end as flow_status,
    (select max(created_at) from event_bus_events) as last_event_time,
    case 
        when (select max(created_at) from event_bus_events) < now() - interval '30 minutes' then '🚨 STALE'
        when (select max(created_at) from event_bus_events) < now() - interval '10 minutes' then '⚠️ SLOW'
        else '✅ FRESH'
    end as freshness_status;

-- 3. Worker performance monitor
create or replace view system_worker_performance as
select 
    queue_name,
    count(*) as total_jobs,
    count(*) filter (where status = 'done') as completed,
    count(*) filter (where status = 'failed') as failed,
    round(
        (count(*) filter (where status = 'done')::decimal / nullif(count(*), 0)) * 100, 
        2
    ) as success_rate,
    case 
        when (count(*) filter (where status = 'failed')::decimal / nullif(count(*), 0)) > 0.2 then '🚨 HIGH FAILURE'
        when (count(*) filter (where status = 'failed')::decimal / nullif(count(*), 0)) > 0.1 then '⚠️ ELEVATED FAILURE'
        else '✅ HEALTHY'
    end as performance_status
from worker_jobs
where created_at >= now() - interval '24 hours'
group by queue_name;

-- 4. Alert aggregator
create or replace function get_system_alerts()
returns table (
    level text,
    metric text,
    message text,
    value text,
    threshold text
) as $$
begin
    -- Queue alerts
    return query
    select 
        case 
            when queued > 50 then 'CRITICAL'
            when queued > 20 then 'WARNING'
            else 'INFO'
        end,
        'queue_backlog',
        case 
            when queued > 50 then 'Queue backlog critical'
            when queued > 20 then 'Queue backlog elevated'
            else 'Queue backlog normal'
        end,
        queued::text,
        case 
            when queued > 50 then '> 50 jobs'
            when queued > 20 then '> 20 jobs'
            else '< 20 jobs'
        end
    from (select count(*) as queued from worker_jobs where status = 'queued') t;
    
    -- Stale jobs alert
    return query
    select 
        case 
            when processing > 30 then 'CRITICAL'
            when processing > 10 then 'WARNING'
            else 'INFO'
        end,
        'stale_jobs',
        case 
            when processing > 30 then 'Jobs stuck in processing'
            when processing > 10 then 'High processing count'
            else 'Processing normal'
        end,
        processing::text,
        case 
            when processing > 30 then '> 30 jobs'
            when processing > 10 then '> 10 jobs'
            else '< 10 jobs'
        end
    from (select count(*) as processing from worker_jobs 
          where status = 'processing' and updated_at < now() - interval '15 minutes') t;
    
    -- Event flow alerts
    return query
    select 
        case 
            when last_event is null or last_event < now() - interval '30 minutes' then 'CRITICAL'
            when last_event < now() - interval '10 minutes' then 'WARNING'
            else 'INFO'
        end,
        'event_flow',
        case 
            when last_event is null or last_event < now() - interval '30 minutes' then 'No events for 30+ minutes'
            when last_event < now() - interval '10 minutes' then 'No events for 10+ minutes'
            else 'Events flowing normally'
        end,
        extract(epoch from now() - coalesce(last_event, now()))::text,
        case 
            when last_event is null or last_event < now() - interval '30 minutes' then '> 30 min'
            when last_event < now() - interval '10 minutes' then '> 10 min'
            else '< 10 min'
        end
    from (select max(created_at) as last_event from event_bus_events) t;
    
    -- Failure rate alerts
    return query
    select 
        case 
            when failure_rate > 0.2 then 'CRITICAL'
            when failure_rate > 0.1 then 'WARNING'
            else 'INFO'
        end,
        'failure_rate',
        case 
            when failure_rate > 0.2 then 'High failure rate detected'
            when failure_rate > 0.1 then 'Elevated failure rate'
            else 'Failure rate normal'
        end,
        round(failure_rate * 100, 2)::text || '%',
        case 
            when failure_rate > 0.2 then '> 20%'
            when failure_rate > 0.1 then '> 10%'
            else '< 10%'
        end
    from (select 
            case 
                when count(*) = 0 then 0
                else (count(*) filter (where status = 'failed'))::decimal / count(*)
            end as failure_rate
          from worker_jobs 
          where created_at >= now() - interval '1 hour') t;
end;
$$ language plpgsql;

-- 5. Quick health check query
select 
    'SYSTEM HEALTH' as status,
    case 
        when (
            (select count(*) from worker_jobs where status = 'queued') < 20
            and (select count(*) from worker_jobs where status = 'failed') < 5
            and (select count(*) from event_bus_events where created_at >= now() - interval '10 minutes') > 0
        ) then '🟢 HEALTHY'
        when (
            (select count(*) from worker_jobs where status = 'queued') < 50
            and (select count(*) from worker_jobs where status = 'failed') < 10
        ) then '🟡 WARNING'
        else '🔴 CRITICAL'
    end as overall,
    (select count(*) from worker_jobs where status = 'queued') as queued,
    (select count(*) from worker_jobs where status = 'failed') as failed,
    (select count(*) from event_bus_events where created_at >= now() - interval '10 minutes') as recent_events;
