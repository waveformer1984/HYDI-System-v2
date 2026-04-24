-- Webhook Events Table for Idempotency
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);

-- Enable RLS
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Policy for service role
DROP POLICY IF EXISTS "webhook_events_service_role" ON webhook_events;
CREATE POLICY "webhook_events_service_role" ON webhook_events
FOR ALL TO service_role USING (true) WITH CHECK (true);
