-- Additional schema for worker system
-- Run this after queue-system.sql

-- Webhook events tracking
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stripe_event_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'queue_failed', 'duplicate')),
    payload JSONB NOT NULL,
    task_id UUID,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event subscriptions
CREATE TABLE IF NOT EXISTS event_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL,
    subscriber TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_type, subscriber)
);

-- Event delivery logs
CREATE TABLE IF NOT EXISTS event_delivery_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    delivered_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    failed_details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Routing logs
CREATE TABLE IF NOT EXISTS routing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_type TEXT NOT NULL,
    source_queue TEXT NOT NULL,
    target_queue TEXT NOT NULL,
    priority INTEGER,
    reason TEXT,
    confidence FLOAT,
    routed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orchestrator metrics
CREATE TABLE IF NOT EXISTS orchestrator_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_counts JSONB NOT NULL,
    queue_stats JSONB NOT NULL,
    system_health JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event bus metrics
CREATE TABLE IF NOT EXISTS event_bus_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id TEXT NOT NULL,
    events_published INTEGER DEFAULT 0,
    events_delivered INTEGER DEFAULT 0,
    events_failed INTEGER DEFAULT 0,
    subscribers_count INTEGER DEFAULT 0,
    events_per_second FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_delivery_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestrator_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_bus_metrics ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "webhook_events_policy" ON webhook_events 
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "event_subscriptions_policy" ON event_subscriptions 
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "event_delivery_logs_policy" ON event_delivery_logs 
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "routing_logs_policy" ON routing_logs 
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "orchestrator_metrics_policy" ON orchestrator_metrics 
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "event_bus_metrics_policy" ON event_bus_metrics 
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id ON webhook_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON webhook_events(created_at);

CREATE INDEX IF NOT EXISTS idx_event_subscriptions_type ON event_subscriptions(event_type);
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_subscriber ON event_subscriptions(subscriber);

CREATE INDEX IF NOT EXISTS idx_routing_logs_created ON routing_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_routing_logs_target ON routing_logs(target_queue);

-- Function to claim webhook event (idempotency)
CREATE OR REPLACE FUNCTION claim_webhook_event(
    p_event_id TEXT,
    p_type TEXT
) RETURNS UUID AS $$
DECLARE
    event_uuid UUID;
BEGIN
    -- Try to insert new event
    INSERT INTO webhook_events (stripe_event_id, type, status)
    VALUES (p_event_id, p_type, 'processing')
    ON CONFLICT (stripe_event_id) DO NOTHING
    RETURNING id INTO event_uuid;
    
    -- If insert failed (duplicate), return null
    IF event_uuid IS NULL THEN
        -- Check if it exists
        SELECT id INTO event_uuid 
        FROM webhook_events 
        WHERE stripe_event_id = p_event_id;
    END IF;
    
    RETURN event_uuid;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup old records
CREATE OR REPLACE FUNCTION cleanup_worker_data() RETURNS VOID AS $$
BEGIN
    -- Cleanup old webhook events (keep 30 days)
    DELETE FROM webhook_events 
    WHERE status IN ('completed', 'failed')
        AND created_at < NOW() - INTERVAL '30 days';
    
    -- Cleanup old delivery logs (keep 7 days)
    DELETE FROM event_delivery_logs 
    WHERE created_at < NOW() - INTERVAL '7 days';
    
    -- Cleanup old metrics (keep 7 days)
    DELETE FROM orchestrator_metrics 
    WHERE created_at < NOW() - INTERVAL '7 days';
    
    DELETE FROM event_bus_metrics 
    WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;
