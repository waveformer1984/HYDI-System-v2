-- Check if hydi_events table exists
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hydi_events';