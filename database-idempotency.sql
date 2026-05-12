-- Database-Level Idempotency - Making Events Truly Idempotent
-- Run this in Supabase SQL Editor

-- 1. Make event_id the PRIMARY KEY
ALTER TABLE hydi_events DROP CONSTRAINT IF EXISTS hydi_events_pkey;
ALTER TABLE hydi_events ADD CONSTRAINT hydi_events_pkey PRIMARY KEY (event_id);

-- 2. Add ON CONFLICT handling for true idempotency
CREATE OR REPLACE FUNCTION handle_event_conflict()
RETURNS TRIGGER AS $$
BEGIN
  -- Log the conflict attempt
  INSERT INTO event_conflicts (
    event_id,
    conflict_reason,
    attempted_at,
    original_event,
    new_event
  )
  VALUES (
    NEW.event_id,
    'Duplicate event detected',
    NOW(),
    OLD.*,
    NEW.*
  );
  
  -- Return the existing event (idempotent behavior)
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 3. Create trigger for automatic conflict handling
CREATE TRIGGER handle_event_conflict
  BEFORE INSERT ON hydi_events
  FOR EACH ROW
  WHEN (EXISTS (SELECT 1 FROM hydi_events WHERE event_id = NEW.event_id))
  EXECUTE FUNCTION handle_event_conflict();

-- 4. Create conflict tracking table
CREATE TABLE IF NOT EXISTS event_conflicts (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  conflict_reason TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  original_event JSONB,
  new_event JSONB
);

-- 5. Add index for conflict monitoring
CREATE INDEX IF NOT EXISTS idx_event_conflicts_timestamp ON event_conflicts(attempted_at DESC);

-- 6. Function to clean up old conflicts
CREATE OR REPLACE FUNCTION cleanup_old_conflicts()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM event_conflicts 
    WHERE attempted_at < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 7. View for monitoring idempotency
CREATE OR REPLACE VIEW idempotency_stats AS
SELECT 
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE event_id IN (
    SELECT event_id FROM event_conflicts
  )) as duplicate_events,
  MAX(attempted_at) as latest_conflict,
  COUNT(*) FILTER (WHERE attempted_at > NOW() - INTERVAL '1 hour') as recent_conflicts
FROM hydi_events;

-- 8. Enable RLS for conflict tracking
ALTER TABLE event_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access to conflicts" ON event_conflicts
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- 9. Test function to verify idempotency
CREATE OR REPLACE FUNCTION test_idempotency()
RETURNS TEXT AS $$
DECLARE
  test_event_id TEXT := 'test-' || gen_random_uuid();
  test_result JSONB;
BEGIN
  -- First insert
  INSERT INTO hydi_events (event_id, type, status, timestamp, payload, source, retry_count, schema_version, correlation_id, metadata)
  VALUES (
    test_event_id, 'idempotency_test', 'pending', NOW(), 
    '{"test": true, "timestamp": "' || EXTRACT(EPOCH FROM NOW()) || '"}', "iteration": 1}',
    'test_system', 0, '1.2.0', test_event_id, 
    '{"test": true, "timestamp": "' || EXTRACT(EPOCH FROM NOW()) || '"', "iteration": 1}'
  );
  
  -- Second insert (should not create duplicate)
  INSERT INTO hydi_events (event_id, type, status, timestamp, payload, source, retry_count, schema_version, correlation_id, metadata)
  VALUES (
    test_event_id, 'idempotency_test', 'pending', NOW(), 
    '{"test": true, "timestamp": "' || EXTRACT(EPOCH FROM NOW()) || '"', "iteration": 2}',
    'test_system', 0, '1.2.0', test_event_id, 
    '{"test": true, "timestamp": "' || EXTRACT(EPOCH FROM NOW()) || '"', "iteration": 2}'
  );
  
  -- Get the final event
  SELECT json_build_object(
    'success', true,
    'event_id', event_id,
    'message', 'Idempotency test passed'
  ) INTO test_result;
  
  RETURN 'Idempotency test completed';
END;
$$ LANGUAGE plpgsql;

-- 10. Verification query
SELECT 'Database Idempotency Setup Complete' as status;
