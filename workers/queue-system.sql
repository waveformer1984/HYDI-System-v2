-- HYDI Worker Queue System
-- Simple but reliable queue implementation using native Postgres
--
-- NOTE: This file is superseded by the tracked migration
--   supabase/migrations/20260617000003_worker_queue_system.sql
-- It is kept runnable for manual/ad-hoc use. The original PARTITION BY HASH
-- version was removed because a partitioned table's PRIMARY KEY must include the
-- partition key (id alone does not include queue_name), so it failed to create.
-- Non-partitioned is correct at this scale. Uses gen_random_uuid() (built-in)
-- instead of uuid_generate_v4() (requires the uuid-ossp extension).

-- Queue tables for each worker type
CREATE TABLE IF NOT EXISTS worker_queues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_name TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    priority INTEGER DEFAULT 0 CHECK (priority >= 0 AND priority <= 10),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- Worker status tracking
CREATE TABLE IF NOT EXISTS worker_status (
    worker_id TEXT PRIMARY KEY,
    worker_type TEXT NOT NULL,
    status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'busy', 'error', 'stopped')),
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    current_task_id UUID REFERENCES worker_queues(id),
    processed_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'
);

-- Event log for debugging
CREATE TABLE IF NOT EXISTS worker_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id TEXT,
    queue_name TEXT,
    event_type TEXT NOT NULL,
    task_id UUID,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_worker_queues_status ON worker_queues(status, queue_name);
CREATE INDEX IF NOT EXISTS idx_worker_queues_priority ON worker_queues(priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_worker_queues_name_status ON worker_queues(queue_name, status);
CREATE INDEX IF NOT EXISTS idx_worker_status_heartbeat ON worker_status(last_heartbeat);

-- RLS Policies
ALTER TABLE worker_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_events ENABLE ROW LEVEL SECURITY;

-- Service role only access
CREATE POLICY "worker_queues_policy" ON worker_queues 
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "worker_status_policy" ON worker_status 
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "worker_events_policy" ON worker_events 
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Queue operations functions

-- Enqueue a task
CREATE OR REPLACE FUNCTION enqueue_task(
    p_queue_name TEXT,
    p_payload JSONB,
    p_priority INTEGER DEFAULT 0,
    p_max_attempts INTEGER DEFAULT 3
) RETURNS UUID AS $$
DECLARE
    task_id UUID;
BEGIN
    INSERT INTO worker_queues (queue_name, payload, priority, max_attempts)
    VALUES (p_queue_name, p_payload, p_priority, p_max_attempts)
    RETURNING id INTO task_id;
    
    -- Log event
    INSERT INTO worker_events (queue_name, event_type, task_id, details)
    VALUES (p_queue_name, 'enqueued', task_id, jsonb_build_object('priority', p_priority));
    
    RETURN task_id;
END;
$$ LANGUAGE plpgsql;

-- Dequeue next task
CREATE OR REPLACE FUNCTION dequeue_task(
    p_queue_name TEXT,
    p_worker_id TEXT
) RETURNS UUID AS $$
DECLARE
    task_id UUID;
BEGIN
    -- Update worker heartbeat
    UPDATE worker_status 
    SET last_heartbeat = NOW(), status = 'busy'
    WHERE worker_id = p_worker_id;
    
    -- Get next task and mark as processing
    UPDATE worker_queues 
    SET status = 'processing',
        attempts = attempts + 1,
        started_at = NOW()
    WHERE id = (
        SELECT id FROM worker_queues 
        WHERE queue_name = p_queue_name 
            AND status = 'pending'
            AND (attempts < max_attempts)
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id INTO task_id;
    
    IF task_id IS NOT NULL THEN
        -- Update worker with current task
        UPDATE worker_status 
        SET current_task_id = task_id, processed_count = processed_count + 1
        WHERE worker_id = p_worker_id;
        
        -- Log event
        INSERT INTO worker_events (worker_id, queue_name, event_type, task_id)
        VALUES (p_worker_id, p_queue_name, 'dequeued', task_id);
    END IF;
    
    RETURN task_id;
END;
$$ LANGUAGE plpgsql;

-- Complete a task
CREATE OR REPLACE FUNCTION complete_task(
    p_task_id UUID,
    p_worker_id TEXT,
    p_success BOOLEAN DEFAULT true,
    p_error_message TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    queue_name TEXT;
BEGIN
    -- Get queue name for logging
    SELECT queue_name INTO queue_name 
    FROM worker_queues 
    WHERE id = p_task_id;
    
    -- Update task status
    IF p_success THEN
        UPDATE worker_queues 
        SET status = 'completed', completed_at = NOW()
        WHERE id = p_task_id;
        
        -- Log success
        INSERT INTO worker_events (worker_id, queue_name, event_type, task_id)
        VALUES (p_worker_id, queue_name, 'completed', p_task_id);
    ELSE
        UPDATE worker_queues 
        SET status = CASE 
                WHEN attempts >= max_attempts THEN 'failed'
                ELSE 'pending'
            END,
            error_message = p_error_message,
            completed_at = CASE 
                WHEN attempts >= max_attempts THEN NOW()
                ELSE NULL
            END
        WHERE id = p_task_id;
        
        -- Update error count
        UPDATE worker_status 
        SET error_count = error_count + 1
        WHERE worker_id = p_worker_id;
        
        -- Log error
        INSERT INTO worker_events (worker_id, queue_name, event_type, task_id, details)
        VALUES (p_worker_id, queue_name, 
                CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retry' END, 
                p_task_id, 
                jsonb_build_object('error', p_error_message));
    END IF;
    
    -- Clear worker current task
    UPDATE worker_status 
    SET current_task_id = NULL, status = 'idle'
    WHERE worker_id = p_worker_id;
END;
$$ LANGUAGE plpgsql;

-- Cleanup old completed tasks
CREATE OR REPLACE FUNCTION cleanup_old_tasks() RETURNS VOID AS $$
BEGIN
    DELETE FROM worker_queues 
    WHERE status IN ('completed', 'failed')
        AND completed_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job for cleanup (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-worker-tasks', '0 2 * * *', 'SELECT cleanup_old_tasks();');
