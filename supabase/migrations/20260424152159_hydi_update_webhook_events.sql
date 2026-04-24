-- Update webhook_events table to match event_bus_events structure for HYDI Stripe sync function

-- Drop existing table and recreate with correct structure
-- This is safer than trying to alter columns when we're not sure of the exact state

DROP TABLE IF EXISTS public.webhook_events CASCADE;

CREATE TABLE public.webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'queued',
    checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_type ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_checked_at ON webhook_events(checked_at);

-- Enable RLS
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Policy for service role
DROP POLICY IF EXISTS "webhook_events_service_role" ON webhook_events;
CREATE POLICY "webhook_events_service_role" ON webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Comment for clarity
COMMENT ON TABLE public.webhook_events IS 'Stores webhook events for HYDI system, matches event_bus_events expectations for Stripe sync function';