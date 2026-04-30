-- Fix missing event_bus_events table dependency
-- This migration creates the event_bus_events table that Stripe sync function depends on

CREATE TABLE IF NOT EXISTS public.event_bus_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_event_bus_events_type_status ON public.event_bus_events(event_type, status);
CREATE INDEX IF NOT EXISTS idx_event_bus_events_created_at ON public.event_bus_events(created_at);
CREATE INDEX IF NOT EXISTS idx_event_bus_events_retry ON public.event_bus_events(status, retry_count, max_retries) WHERE status = 'failed';

-- RLS
ALTER TABLE public.event_bus_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event bus events are viewable by authenticated users" ON public.event_bus_events
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Event bus events are manageable by service role" ON public.event_bus_events
    FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.event_bus_events IS 'Event bus for system events - used by Stripe sync and other integrations';
