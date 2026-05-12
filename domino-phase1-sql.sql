-- DOMINO PROTOCOL - PHASE 1: FOUNDATION SQL
-- Execute in Supabase SQL Editor

-- Step 1: Add missing columns to hydi_events
ALTER TABLE hydi_events 
ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS schema_version TEXT DEFAULT '1.2.0',
ADD COLUMN IF NOT EXISTS correlation_id TEXT DEFAULT NULL;

-- Step 2: Add required tables for idempotency and processing
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
  processing_failed BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS processing_locks (
  event_id TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  config_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 3: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_hydi_events_correlation_id ON hydi_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_hydi_events_type_status ON hydi_events(type, status);
CREATE INDEX IF NOT EXISTS idx_hydi_events_timestamp_desc ON hydi_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_processed_events_timestamp ON processed_events(processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_locks_expires ON processing_locks(expires_at);

-- Step 4: Enable Row Level Security
ALTER TABLE hydi_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Step 5: Add RLS policies
CREATE POLICY "Service role full access on hydi_events" ON hydi_events
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access on processed_events" ON processed_events
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access on processing_locks" ON processing_locks
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access on system_config" ON system_config
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Step 6: CRITICAL - Force PostgREST cache refresh
NOTIFY pgrst, 'reload schema';

-- Step 7: Verification queries
SELECT 'Foundation SQL completed' as status,
       COUNT(*) as hydi_events_count 
FROM hydi_events;

SELECT 'Tables created' as status,
       COUNT(*) as table_count
FROM information_schema.tables 
WHERE table_name IN ('hydi_events', 'processed_events', 'processing_locks', 'system_config')
AND table_schema = 'public';
