-- Enable RLS on hydi_events table
ALTER TABLE hydi_events ENABLE ROW LEVEL SECURITY;

-- Allow all operations for development (remove this in production)
CREATE POLICY "Allow all operations on hydi_events" ON hydi_events
  FOR ALL USING (true) WITH CHECK (true);