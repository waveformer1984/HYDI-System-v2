-- Rollback for 20260724000001_event_bus_events_projection_marker.sql

DROP INDEX IF EXISTS public.idx_event_bus_events_projected_at;

ALTER TABLE public.event_bus_events DROP COLUMN IF EXISTS projected_at;
