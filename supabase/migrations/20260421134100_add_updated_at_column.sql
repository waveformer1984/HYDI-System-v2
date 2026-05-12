-- Add updated_at column for tracking event state changes
ALTER TABLE hydi_events ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create index on updated_at for performance
CREATE INDEX IF NOT EXISTS idx_hydi_events_updated_at ON hydi_events(updated_at DESC);
