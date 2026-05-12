-- Supabase Schema Fix - Add missing columns
-- Run this in Supabase SQL Editor

-- Add retry_count column
ALTER TABLE hydi_events 
ADD COLUMN retry_count INT DEFAULT 0;

-- Add source column  
ALTER TABLE hydi_events
ADD COLUMN source TEXT NOT NULL DEFAULT 'orchestrator';

-- Force schema refresh for PostgREST
NOTIFY pgrst, 'reload schema';

-- Verify the changes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'hydi_events' 
  AND column_name IN ('retry_count', 'source')
ORDER BY column_name;
