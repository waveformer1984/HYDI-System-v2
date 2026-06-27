-- Migration: 20260521000001_fix_hydi_events_event_id_default
--
-- Problem: hydi_events.event_id has no DEFAULT, so every inserted row
-- gets NULL. The consumer-loop _claim() uses event_id as its WHERE key;
-- NULL event_ids cause every claim to silently no-op (Postgres evaluates
-- WHERE event_id = NULL as always-false).
--
-- Fix:
--   1. Set DEFAULT gen_random_uuid() so future inserts auto-populate.
--   2. Backfill all existing NULL rows with generated UUIDs.
--   3. Add NOT NULL constraint now that all rows are populated.

-- Only apply if hydi_events table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'hydi_events'
  ) THEN
    -- Step 1: add default
    ALTER TABLE hydi_events
      ALTER COLUMN event_id SET DEFAULT gen_random_uuid();

    -- Step 2: backfill existing null rows
    UPDATE hydi_events
       SET event_id = gen_random_uuid()
     WHERE event_id IS NULL;

    -- Step 3: enforce NOT NULL now that backfill is complete
    ALTER TABLE hydi_events
      ALTER COLUMN event_id SET NOT NULL;

    -- Also normalise the `type` column
    UPDATE hydi_events
       SET type = event_type
     WHERE (type IS NULL OR type = 'unknown')
       AND event_type IS NOT NULL
       AND event_type != '';
  END IF;
END $$;
