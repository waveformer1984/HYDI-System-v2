-- Add audit trail columns for state transitions
ALTER TABLE hydi_events ADD COLUMN failure_reason TEXT;
ALTER TABLE hydi_events ADD COLUMN final_failure_at TIMESTAMPTZ;
ALTER TABLE hydi_events ADD COLUMN state_history JSONB DEFAULT '[]'::jsonb;

-- Create index on audit columns
CREATE INDEX IF NOT EXISTS idx_hydi_events_permanently_failed ON hydi_events(status) WHERE status = 'permanently_failed';
CREATE INDEX IF NOT EXISTS idx_hydi_events_final_failure_at ON hydi_events(final_failure_at DESC) WHERE final_failure_at IS NOT NULL;

-- Create trigger function to update state history
CREATE OR REPLACE FUNCTION update_state_history()
RETURNS TRIGGER AS $$
BEGIN
  -- Append state change to history
  NEW.state_history = COALESCE(NEW.state_history, '[]'::jsonb) || jsonb_build_object(
    'timestamp', NOW(),
    'from_status', COALESCE(OLD.status, 'new'),
    'to_status', NEW.status,
    'reason', NEW.failure_reason
  );
  
  -- Update updated_at timestamp
  NEW.updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically track state changes
DROP TRIGGER IF EXISTS hydi_events_state_trigger ON hydi_events;
CREATE TRIGGER hydi_events_state_trigger
  BEFORE UPDATE ON hydi_events
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.failure_reason IS DISTINCT FROM NEW.failure_reason)
  EXECUTE FUNCTION update_state_history();
