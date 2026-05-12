-- Production Database Setup for HYDI System
-- Run this in Supabase SQL Editor

-- ==========================================
-- EVENT CONTRACTS AND IDEMPOTENCY TABLES
-- ==========================================

-- Table for tracking processed events (idempotency)
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result JSONB,
  schema_version TEXT,
  processing_duration INTEGER,
  error TEXT,
  processing_failed BOOLEAN DEFAULT FALSE,
  INDEX(correlation_id),
  INDEX(processed_at),
  INDEX(type, status)
);

-- Table for processing locks (idempotency)
CREATE TABLE IF NOT EXISTS processing_locks (
  event_id TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  INDEX(expires_at)
);

-- Table for system configuration (source of truth)
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  config_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  INDEX(config_type)
);

-- ==========================================
-- HYDI EVENTS TABLE UPDATES
-- ==========================================

-- Add missing columns for event contracts
ALTER TABLE hydi_events 
ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS schema_version TEXT DEFAULT '1.2.0',
ADD COLUMN IF NOT EXISTS correlation_id TEXT DEFAULT NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_hydi_events_correlation_id ON hydi_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_hydi_events_type_status ON hydi_events(type, status);
CREATE INDEX IF NOT EXISTS idx_hydi_events_timestamp_desc ON hydi_events(timestamp DESC);

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================

-- Enable RLS on all tables
ALTER TABLE hydi_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Policy for service role (full access)
CREATE POLICY "Service role full access on hydi_events" ON hydi_events
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access on processed_events" ON processed_events
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access on processing_locks" ON processing_locks
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access on system_config" ON system_config
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Policy for anon role (read-only access to processed_events)
CREATE POLICY "Anon read access to processed_events" ON processed_events
  FOR SELECT USING (auth.jwt() ->> 'role' = 'anon');

-- Policy for anon role (no access to processing_locks)
CREATE POLICY "Deny anon access to processing_locks" ON processing_locks
  FOR ALL USING (auth.jwt() ->> 'role' = 'anon');

-- Policy for anon role (no access to system_config)
CREATE POLICY "Deny anon access to system_config" ON system_config
  FOR ALL USING (auth.jwt() ->> 'role' = 'anon');

-- ==========================================
-- FUNCTIONS AND TRIGGERS
-- ==========================================

-- Function to clean up expired locks
CREATE OR REPLACE FUNCTION cleanup_expired_locks()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM processing_locks
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for system_config
CREATE TRIGGER update_system_config_timestamp
  BEFORE UPDATE ON system_config
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp();

-- ==========================================
-- VIEWS FOR MONITORING
-- ==========================================

-- View for system health monitoring
CREATE OR REPLACE VIEW system_health AS
SELECT 
  'event_processing' as component,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE status = 'processed') as processed_events,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_events,
  COUNT(*) FILTER (WHERE status = 'pending') as pending_events,
  MAX(timestamp) as latest_event,
  MIN(timestamp) as earliest_event,
  AVG(EXTRACT(EPOCH FROM (timestamp - '1970-01-01T00:00:00Z')) as avg_timestamp_epoch
FROM hydi_events;

-- View for lock monitoring
CREATE OR REPLACE VIEW lock_status AS
SELECT 
  COUNT(*) as active_locks,
  COUNT(*) FILTER (WHERE expires_at < NOW()) as expired_locks,
  MAX(locked_at) as oldest_lock,
  MIN(expires_at) as next_expiry
FROM processing_locks;

-- View for processing statistics
CREATE OR REPLACE VIEW processing_stats AS
SELECT 
  DATE_TRUNC('hour', processed_at) as hour,
  COUNT(*) as total_processed,
  AVG(processing_duration) as avg_duration_ms,
  MIN(processing_duration) as min_duration_ms,
  MAX(processing_duration) as max_duration_ms,
  COUNT(*) FILTER (WHERE processing_failed = true) as failed_count,
  COUNT(*) FILTER (WHERE error IS NOT NULL) as error_count
FROM processed_events
WHERE processed_at >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', processed_at)
ORDER BY hour DESC;

-- ==========================================
-- SAMPLE DATA AND SETUP
-- ==========================================

-- Insert sample system configuration
INSERT INTO system_config (key, value, config_type) VALUES
('environment', 'production', 'environment'),
('version', '1.0.0', 'environment'),
('supabase_url', 'https://wufhlhrbskacneneylqa.supabase.co', 'environment')
ON CONFLICT (key) DO NOTHING;

-- Create a function to reset the system (for testing)
CREATE OR REPLACE FUNCTION reset_system()
RETURNS TEXT AS $$
BEGIN
  -- Clean up processed events
  DELETE FROM processed_events;
  
  -- Clean up processing locks
  DELETE FROM processing_locks;
  
  -- Reset system config
  UPDATE system_config SET updated_at = NOW();
  
  RETURN 'System reset completed';
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- VERIFICATION QUERIES
-- ==========================================

-- Verify all tables exist
SELECT 
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'public'
  AND TABLE_NAME IN ('hydi_events', 'processed_events', 'processing_locks', 'system_config')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- Verify indexes exist
SELECT 
  indexname,
  tablename,
  indexdef
FROM pg_indexes 
WHERE schemaname = 'public'
  AND tablename IN ('hydi_events', 'processed_events', 'processing_locks', 'system_config')
ORDER BY tablename, indexname;

-- Verify RLS policies exist
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies 
WHERE schemaname = 'public'
  AND tablename IN ('hydi_events', 'processed_events', 'processing_locks', 'system_config')
ORDER BY tablename, policyname;

-- Verify views exist
SELECT 
  viewname,
  viewowner,
  definition
FROM pg_views 
WHERE viewname IN ('system_health', 'lock_status', 'processing_stats')
ORDER BY viewname;

-- ==========================================
-- COMPLETION MESSAGE
-- ==========================================

DO $$
BEGIN
  RAISE NOTICE 'HYDI Production Database Setup Complete';
  RAISE NOTICE 'Tables: hydi_events, processed_events, processing_locks, system_config';
  RAISE NOTICE 'Indexes: Created for performance';
  RAISE NOTICE 'RLS: Enabled with proper policies';
  RAISE NOTICE 'Functions: cleanup_expired_locks, update_timestamp';
  RAISE NOTICE 'Views: system_health, lock_status, processing_stats';
  RAISE NOTICE 'Ready for production deployment';
END $$;
