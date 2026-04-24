-- ========================================
-- PHASE 1: REVENUE INTELLIGENCE LAYER
-- ========================================

-- 1. Revenue summary materialized view
create materialized view public.revenue_summary_daily as
select 
    date_trunc('day', created_at) as revenue_date,
    count(*) filter (where type = 'invoice.payment_succeeded') as successful_payments,
    count(*) filter (where type = 'invoice.payment_failed') as failed_payments,
    round(
        sum((payload->'data'->'object'->'amount')::decimal / 100) filter (where type = 'invoice.payment_succeeded'), 
        2
    ) as total_revenue,
    round(
        avg((payload->'data'->'object'->'amount')::decimal / 100) filter (where type = 'invoice.payment_succeeded'), 
        2
    ) as avg_order_value,
    now() as last_updated
from webhook_events
where type in ('invoice.payment_succeeded', 'invoice.payment_failed')
  and created_at >= now() - interval '30 days'
group by date_trunc('day', created_at);

-- Unique index for refresh
create unique index revenue_summary_daily_date_idx 
on public.revenue_summary_daily (revenue_date);

-- 2. Revenue anomaly detection
create or replace function public.detect_revenue_anomalies()
returns void
language plpgsql
as $$
declare
    today_revenue decimal;
    yesterday_revenue decimal;
    revenue_change decimal;
    anomaly_type text;
    anomaly_message text;
    last_hour_revenue decimal;
begin
    -- Refresh materialized view
    refresh materialized view concurrently public.revenue_summary_daily;
    
    -- Get today and yesterday revenue
    select total_revenue into today_revenue
    from public.revenue_summary_daily
    where revenue_date = date_trunc('day', now());
    
    select total_revenue into yesterday_revenue
    from public.revenue_summary_daily
    where revenue_date = date_trunc('day', now() - interval '1 day');
    
    -- Check for 30% drop
    if yesterday_revenue > 0 and today_revenue < yesterday_revenue * 0.7 then
        revenue_change := (today_revenue / yesterday_revenue - 1) * 100;
        anomaly_type := 'revenue_drop';
        anomaly_message := format('Revenue dropped %.1f%% today ($%.2f vs $%.2f yesterday)', 
                                abs(revenue_change), today_revenue, yesterday_revenue);
        
        insert into public.event_bus_events (
            topic, 
            event_name, 
            source_worker, 
            correlation_id, 
            payload, 
            occurred_at
        ) values (
            'alerts:revenue',
            'revenue_drop_detected',
            'revenue_monitor',
            gen_random_uuid()::text,
            jsonb_build_object(
                'type', anomaly_type,
                'message', anomaly_message,
                'today_revenue', today_revenue,
                'yesterday_revenue', yesterday_revenue,
                'percent_change', revenue_change
            ),
            now()
        );
    end if;
    
    -- Check for 50% spike
    if yesterday_revenue > 0 and today_revenue > yesterday_revenue * 1.5 then
        revenue_change := (today_revenue / yesterday_revenue - 1) * 100;
        anomaly_type := 'revenue_spike';
        anomaly_message := format('Revenue spiked %.1f%% today ($%.2f vs $%.2f yesterday)', 
                                revenue_change, today_revenue, yesterday_revenue);
        
        insert into public.event_bus_events (
            topic, 
            event_name, 
            source_worker, 
            correlation_id, 
            payload, 
            occurred_at
        ) values (
            'alerts:revenue',
            'revenue_spike_detected',
            'revenue_monitor',
            gen_random_uuid()::text,
            jsonb_build_object(
                'type', anomaly_type,
                'message', anomaly_message,
                'today_revenue', today_revenue,
                'yesterday_revenue', yesterday_revenue,
                'percent_change', revenue_change
            ),
            now()
        );
    end if;
    
    -- Check for zero revenue in last hour
    select sum((payload->'data'->'object'->'amount')::decimal / 100) into last_hour_revenue
    from webhook_events
    where type = 'invoice.payment_succeeded'
      and created_at >= now() - interval '1 hour';
    
    if last_hour_revenue = 0 then
        anomaly_type := 'no_revenue_hour';
        anomaly_message := 'No revenue in the last hour';
        
        insert into public.event_bus_events (
            topic, 
            event_name, 
            source_worker, 
            correlation_id, 
            payload, 
            occurred_at
        ) values (
            'alerts:revenue',
            'no_revenue_detected',
            'revenue_monitor',
            gen_random_uuid()::text,
            jsonb_build_object(
                'type', anomaly_type,
                'message', anomaly_message,
                'hour_revenue', last_hour_revenue
            ),
            now()
        );
    end if;
end;
$$;

-- 3. Schedule revenue monitoring
select cron.schedule(
    'revenue_anomaly_detection',
    '*/5 * * * *',
    $$ select public.detect_revenue_anomalies(); $$
);

-- ========================================
-- PHASE 2: ENTITLEMENT AUTOMATION
-- ========================================

-- Extend entitlements table if needed
alter table public.entitlements 
add column if not exists start_date timestamptz default now(),
add column if not exists end_date timestamptz,
add column if not exists status text default 'active',
add column if not exists metadata jsonb default '{}';

-- Create entitlement on checkout completion
create or replace function public.create_entitlement_from_checkout()
returns trigger
language plpgsql
as $$
begin
    -- Insert or update entitlement
    insert into public.entitlements (
        customer_id,
        product_id,
        status,
        start_date,
        source_event_id,
        metadata
    ) values (
        new.payload->'data'->'object'->'customer',
        new.payload->'data'->'object'->'metadata'->'product_id',
        'active',
        now(),
        new.event_id,
        jsonb_build_object(
            'checkout_session', new.payload->'data'->'object'->'id',
            'amount', new.payload->'data'->'object'->'amount_total',
            'currency', new.payload->'data'->'object'->'currency'
        )
    )
    on conflict (customer_id, product_id) 
    do update set
        status = 'active',
        start_date = now(),
        source_event_id = new.event_id,
        metadata = entitlements.metadata || excluded.metadata,
        updated_at = now();
    
    -- Emit entitlement granted event
    insert into public.event_bus_events (
        topic,
        event_name,
        source_worker,
        correlation_id,
        payload,
        occurred_at
    ) values (
        'entitlements:granted',
        'entitlement_created',
        'checkout_processor',
        new.event_id,
        jsonb_build_object(
            'customer_id', new.payload->'data'->'object'->'customer',
            'product_id', new.payload->'data'->'object'->'metadata'->'product_id',
            'event_id', new.event_id
        ),
        now()
    );
    
    return new;
end;
$$;

-- Create trigger for checkout completion
drop trigger if exists on_checkout_complete on public.webhook_events;
create trigger on_checkout_complete
    after insert on public.webhook_events
    for each row
    when (new.type = 'checkout.session.completed')
    execute function public.create_entitlement_from_checkout();

-- Detect missing entitlements
create or replace function public.detect_missing_entitlements()
returns void
language plpgsql
as $$
declare
    missing_count integer;
    missing_record record;
begin
    -- Find payments without entitlements
    for missing_record in 
        select 
            we.event_id,
            we.payload->'data'->'object'->'customer' as customer_id,
            we.payload->'data'->'object'->'amount' as amount,
            we.created_at
        from webhook_events we
        left join entitlements e on e.source_event_id = we.event_id
        where we.type = 'invoice.payment_succeeded'
          and we.created_at >= now() - interval '1 hour'
          and e.id is null
    loop
        insert into public.event_bus_events (
            topic,
            event_name,
            source_worker,
            correlation_id,
            payload,
            occurred_at
        ) values (
            'alerts:critical',
            'missing_entitlement',
            'entitlement_monitor',
            missing_record.event_id,
            jsonb_build_object(
                'severity', 'CRITICAL',
                'customer_id', missing_record.customer_id,
                'amount', missing_record.amount,
                'payment_event', missing_record.event_id,
                'payment_time', missing_record.created_at
            ),
            now()
        );
    end loop;
    
    -- Get count for summary
    select count(*) into missing_count
    from webhook_events we
    left join entitlements e on e.source_event_id = we.event_id
    where we.type = 'invoice.payment_succeeded'
      and we.created_at >= now() - interval '1 hour'
      and e.id is null;
    
    -- Emit summary if any missing
    if missing_count > 0 then
        insert into public.event_bus_events (
            topic,
            event_name,
            source_worker,
            correlation_id,
            payload,
            occurred_at
        ) values (
            'alerts:summary',
            'missing_entitlements_summary',
            'entitlement_monitor',
            gen_random_uuid()::text,
            jsonb_build_object(
                'missing_count', missing_count,
                'time_window', 'last_hour'
            ),
            now()
        );
    end if;
end;
$$;

-- Schedule missing entitlement check
select cron.schedule(
    'missing_entitlement_detection',
    '*/2 * * * *',
    $$ select public.detect_missing_entitlements(); $$
);

-- ========================================
-- PHASE 3: FAILURE RECOVERY INTELLIGENCE
-- ========================================

-- Enhanced retry with exponential backoff
create or replace function public.retry_failed_jobs()
returns table(retried_count bigint)
language plpgsql
as $$
declare
    v_retried bigint := 0;
    v_backoff_seconds integer;
    job_record record;
begin
    -- Process failed jobs with exponential backoff
    for job_record in 
        select 
            id,
            queue_name,
            attempts,
            error_message,
            created_at
        from worker_jobs
        where status = 'failed'
          and attempts < 5
          and (updated_at < now() - (power(2, attempts) * 30) * interval '1 second')
        order by created_at
        limit 20
    loop
        -- Calculate backoff
        v_backoff_seconds := power(2, job_record.attempts) * 30;
        
        -- Update job for retry
        update worker_jobs
        set 
            status = 'queued',
            attempts = attempts + 1,
            error_message = null,
            available_at = now() + (v_backoff_seconds || ' seconds')::interval,
            updated_at = now()
        where id = job_record.id;
        
        v_retried := v_retried + 1;
        
        -- Log retry attempt
        insert into public.event_bus_events (
            topic,
            event_name,
            source_worker,
            correlation_id,
            payload,
            occurred_at
        ) values (
            'workers:retry',
            'job_retried',
            'retry_manager',
            job_record.id::text,
            jsonb_build_object(
                'job_id', job_record.id,
                'queue', job_record.queue_name,
                'attempt', job_record.attempts + 1,
                'backoff_seconds', v_backoff_seconds
            ),
            now()
        );
    end loop;
    
    -- Move permanently failed jobs to dead letter
    update worker_jobs
    set status = 'dead'
    where status = 'failed'
      and attempts >= 5
      and updated_at < now() - interval '1 hour';
    
    return next v_retried;
end;
$$;

-- Dead letter analysis
create or replace function public.dead_letter_analysis()
returns void
language plpgsql
as $$
declare
    analysis_window interval := interval '10 minutes';
    analysis_result jsonb;
begin
    -- Group failures by reason
    select jsonb_agg(
        jsonb_build_object(
            'error_pattern', error_pattern,
            'count', failure_count,
            'queue', queue_name
        )
    ) into analysis_result
    from (
        select 
            case 
                when error_message like '%timeout%' then 'timeout'
                when error_message like '%connection%' then 'connection_error'
                when error_message like '%permission%' then 'permission_error'
                when error_message like '%not found%' then 'not_found'
                else 'other'
            end as error_pattern,
            queue_name,
            count(*) as failure_count
        from worker_jobs
        where status = 'dead'
          and updated_at >= now() - analysis_window
        group by error_pattern, queue_name
        having count(*) > 0
    ) t;
    
    -- Emit analysis if any failures
    if analysis_result is not null then
        insert into public.event_bus_events (
            topic,
            event_name,
            source_worker,
            correlation_id,
            payload,
            occurred_at
        ) values (
            'workers:analysis',
            'dead_letter_summary',
            'failure_analyzer',
            gen_random_uuid()::text,
            jsonb_build_object(
                'analysis_window_minutes', 10,
                'failure_patterns', analysis_result,
                'total_dead_jobs', (select count(*) from worker_jobs where status = 'dead')
            ),
            now()
        );
    end if;
end;
$$;

-- Schedule dead letter analysis
select cron.schedule(
    'dead_letter_analysis',
    '*/10 * * * *',
    $$ select public.dead_letter_analysis(); $$
);

-- ========================================
-- PHASE 4: REALTIME VISIBILITY
-- ========================================

-- Create realtime publication
drop publication if exists supabase_realtime;
create publication supabase_realtime 
for table public.event_bus_events,
     table public.worker_jobs,
     table public.entitlements,
     table public.revenue_summary_daily;

-- Broadcast critical alerts
create or replace function public.broadcast_critical_alerts()
returns trigger
language plpgsql
as $$
begin
    -- This will automatically broadcast via realtime
    -- due to the publication above
    return new;
end;
$$;

-- Create trigger for critical alerts
create trigger broadcast_alerts
    after insert on public.event_bus_events
    for each row
    when (new.topic like 'alerts:%')
    execute function public.broadcast_critical_alerts();

-- ========================================
-- PHASE 5: BUSINESS DASHBOARD VIEW
-- ========================================

create or replace view public.system_business_dashboard as
with metrics as (
    select 
        'queue_size' as metric,
        (select count(*)::text from worker_jobs where status = 'queued') as value,
        case 
            when (select count(*) from worker_jobs where status = 'queued') > 50 then '🔴'
            when (select count(*) from worker_jobs where status = 'queued') > 20 then '🟡'
            else '🟢'
        end as status
    union all
    select 
        'revenue_today' as metric,
        '$' || coalesce(total_revenue::text, '0.00'),
        case 
            when total_revenue < (select total_revenue from revenue_summary_daily where revenue_date = current_date - interval '1 day') * 0.7 then '🔴'
            else '🟢'
        end
    from public.revenue_summary_daily
    where revenue_date = current_date
    union all
    select 
        'failed_payments' as metric,
        (select count(*)::text from webhook_events where type = 'invoice.payment_failed' and created_at >= current_date)::text,
        case 
            when (select count(*) from webhook_events where type = 'invoice.payment_failed' and created_at >= current_date) > 5 then '🔴'
            when (select count(*) from webhook_events where type = 'invoice.payment_failed' and created_at >= current_date) > 0 then '🟡'
            else '🟢'
        end
    union all
    select 
        'missing_entitlements' as metric,
        (select count(*)::text from payment_entitlement_gaps where status = 'NOT_GRANTED')::text,
        case 
            when (select count(*) from payment_entitlement_gaps where status = 'NOT_GRANTED') > 0 then '🔴'
            else '🟢'
        end
    union all
    select 
        'active_alerts' as metric,
        (select count(*)::text from get_system_alerts() where level = 'CRITICAL')::text,
        case 
            when (select count(*) from get_system_alerts() where level = 'CRITICAL') > 0 then '🔴'
            when (select count(*) from get_system_alerts() where level = 'WARNING') > 0 then '🟡'
            else '🟢'
        end
    union all
    select 
        'last_event' as metric,
        extract(epoch from now() - max(created_at))::text || 's ago',
        case 
            when max(created_at) < now() - interval '10 minutes' then '🔴'
            when max(created_at) < now() - interval '5 minutes' then '🟡'
            else '🟢'
        end
    from webhook_events
)
select * from metrics order by metric;

-- ========================================
-- PHASE 6: SELF-HEALING LOOP
-- ========================================

create or replace function public.self_heal_system()
returns void
language plpgsql
as $$
declare
    queue_size integer;
    failure_rate decimal;
    recent_events integer;
    healing_action text;
begin
    -- Get current metrics
    select count(*) into queue_size
    from worker_jobs
    where status = 'queued';
    
    select case 
        when count(*) = 0 then 0
        else (count(*) filter (where status = 'failed'))::decimal / count(*)
    end into failure_rate
    from worker_jobs
    where created_at >= now() - interval '1 hour';
    
    select count(*) into recent_events
    from webhook_events
    where created_at >= now() - interval '5 minutes';
    
    -- Self-healing logic
    
    -- 1. Queue backlog handling
    if queue_size > 100 then
        -- Emergency: trigger additional worker instances
        insert into public.event_bus_events (
            topic,
            event_name,
            source_worker,
            correlation_id,
            payload,
            occurred_at
        ) values (
            'system:healing',
            'emergency_queue_processing',
            'self_healer',
            gen_random_uuid()::text,
            jsonb_build_object(
                'action', 'increase_concurrency',
                'queue_size', queue_size,
                'reason', 'critical_backlog'
            ),
            now()
        );
        healing_action := 'Increased worker concurrency';
    end if;
    
    -- 2. High failure rate handling
    if failure_rate > 0.3 then
        -- Pause retries temporarily to prevent cascading failures
        update worker_jobs
        set status = 'paused',
            updated_at = now()
        where status = 'failed'
          and attempts < 5;
        
        insert into public.event_bus_events (
            topic,
            event_name,
            source_worker,
            correlation_id,
            payload,
            occurred_at
        ) values (
            'system:healing',
            'pause_retries',
            'self_healer',
            gen_random_uuid()::text,
            jsonb_build_object(
                'action', 'paused_retries',
                'failure_rate', failure_rate,
                'reason', 'high_failure_rate'
            ),
            now()
        );
        healing_action := healing_action || ', Paused retries';
    end if;
    
    -- 3. No events detection
    if recent_events = 0 then
        insert into public.event_bus_events (
            topic,
            event_name,
            source_worker,
            correlation_id,
            payload,
            occurred_at
        ) values (
            'alerts:critical',
            'no_webhook_events',
            'self_healer',
            gen_random_uuid()::text,
            jsonb_build_object(
                'action', 'heartbeat_check',
                'last_event_time', (select max(created_at) from webhook_events),
                'reason', 'no_recent_activity'
            ),
            now()
        );
        healing_action := healing_action || ', Triggered heartbeat alert';
    end if;
    
    -- Log healing action if any taken
    if healing_action is not null then
        insert into public.event_bus_events (
            topic,
            event_name,
            source_worker,
            correlation_id,
            payload,
            occurred_at
        ) values (
            'system:healing',
            'healing_actions_taken',
            'self_healer',
            gen_random_uuid()::text,
            jsonb_build_object(
                'actions', healing_action,
                'queue_size', queue_size,
                'failure_rate', failure_rate,
                'recent_events', recent_events
            ),
            now()
        );
    end if;
end;
$$;

-- Schedule self-healing
select cron.schedule(
    'self_healing_loop',
    '*/2 * * * *',
    $$ select public.self_heal_system(); $$
);

-- ========================================
-- SUMMARY OF NEW CRON JOBS
-- ========================================

-- List all scheduled jobs
select 
    jobid,
    jobname,
    schedule,
    active,
    'cron.job' as source
from cron.job
where jobname in (
    'revenue_anomaly_detection',
    'missing_entitlement_detection',
    'dead_letter_analysis',
    'self_healing_loop'
)
order by jobid;
