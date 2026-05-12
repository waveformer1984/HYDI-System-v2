-- Verify hydi_events table exists and show structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'hydi_events'
ORDER BY ordinal_position;