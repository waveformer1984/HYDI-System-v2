-- Phase 6: event_bus_events projection bridge
-- Adds a projection marker to event_bus_events so the Event Fabric adapter can
-- fan legacy Postgres events into the in-process bus exactly once.

ALTER TABLE public.event_bus_events ADD COLUMN IF NOT EXISTS projected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_event_bus_events_projected_at
    ON public.event_bus_events (projected_at)
    WHERE projected_at IS NULL;
