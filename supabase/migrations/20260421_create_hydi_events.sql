-- Create hydi_events table for storing system events
CREATE TABLE IF NOT EXISTS hydi_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_hydi_events_event_id ON hydi_events(event_id);
CREATE INDEX IF NOT EXISTS idx_hydi_events_type ON hydi_events(type);
CREATE INDEX IF NOT EXISTS idx_hydi_events_processed ON hydi_events(processed);

-- Enable row level security (optional but recommended)
ALTER TABLE hydi_events ENABLE ROW LEVEL SECURITY;

-- Create policy for insert (adjust as needed for your security model)
CREATE POLICY "Allow inserts" ON hydi_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow selects" ON hydi_events FOR SELECT USING (true);
CREATE POLICY "Allow updates" ON hydi_events FOR UPDATE USING (true);
