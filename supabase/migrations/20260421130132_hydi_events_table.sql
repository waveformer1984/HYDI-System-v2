-- Create hydi_events table for HYDI system
CREATE TABLE IF NOT EXISTS hydi_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT UNIQUE NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('error','task','info')),
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending','processed','failed')),
  ai_analysis TEXT,
  retries INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_hydi_events_status ON hydi_events(status);
CREATE INDEX idx_hydi_events_type ON hydi_events(type);
CREATE INDEX idx_hydi_events_timestamp ON hydi_events(timestamp DESC);

-- Add RLS policies
ALTER TABLE hydi_events ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations (for development)
CREATE POLICY "Allow all operations on hydi_events" ON hydi_events
  FOR ALL USING (true) WITH CHECK (true);