-- Production Database Optimizations for HYDI System
-- Run these on Supabase SQL Editor

-- 1. Enable Row Level Security (RLS)
ALTER TABLE hydi_events ENABLE ROW LEVEL SECURITY;

-- 2. Create RLS Policies
-- Allow service role to do anything (for HYDI Processor)
CREATE POLICY "Allow service role full access" ON hydi_events
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Allow anonymous users to read only (for Ursula Dashboard)
CREATE POLICY "Allow anonymous read access" ON hydi_events
  FOR SELECT USING (auth.jwt() ->> 'role' = 'anon');

-- 3. Performance Indexes
-- Index for dashboard queries (type + timestamp)
CREATE INDEX idx_hydi_events_type_timestamp ON hydi_events(type, timestamp DESC);

-- Index for event lookups
CREATE INDEX idx_hydi_events_event_id ON hydi_events(event_id);

-- Index for retry tracking
CREATE INDEX idx_hydi_events_status_retries ON hydi_events(status, retries);

-- 4. Partitioning (if table grows > 1M rows)
-- Uncomment for large-scale deployment
/*
CREATE TABLE hydi_events_partitioned (
  LIKE hydi_events INCLUDING ALL
) PARTITION BY RANGE (timestamp);

CREATE TABLE hydi_events_2026_04 PARTITION OF hydi_events_partitioned
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE hydi_events_2026_05 PARTITION OF hydi_events_partitioned
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
*/

-- 5. Read Replica Setup (Supabase-specific)
-- This is typically done via Supabase dashboard
-- Settings: Database -> Replicas -> Create Read Replica

-- 6. Monitoring Functions
CREATE OR REPLACE FUNCTION hydi_event_stats()
RETURNS TABLE(
  total_events BIGINT,
  pending_events BIGINT,
  processed_events BIGINT,
  failed_events BIGINT,
  avg_retries DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_events,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_events,
    COUNT(*) FILTER (WHERE status = 'processed') as processed_events,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_events,
    AVG(retries) as avg_retries
  FROM hydi_events
  WHERE timestamp >= NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- 7. Cleanup Function (for automated maintenance)
CREATE OR REPLACE FUNCTION cleanup_old_events()
RETURNS BIGINT AS $$
DECLARE
  deleted_count BIGINT;
BEGIN
  DELETE FROM hydi_events 
  WHERE timestamp < NOW() - INTERVAL '90 days'
  AND status IN ('processed', 'failed');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
