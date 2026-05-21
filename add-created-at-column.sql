-- Add missing created_at column to hydi_events table
-- This column is required by the application for polling and event tracking

-- Add the created_at column with default NOW()
ALTER TABLE public.hydi_events
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Create an index on created_at for performance
CREATE INDEX IF NOT EXISTS idx_hydi_events_created_at ON public.hydi_events(created_at DESC);

-- Create an index on created_at with status for filtering
CREATE INDEX IF NOT EXISTS idx_hydi_events_created_at_status ON public.hydi_events(created_at DESC, status);

-- Verify the column exists
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'hydi_events'
  AND column_name = 'created_at';

-- Count total events
SELECT COUNT(*) as total_events FROM public.hydi_events;

-- Show column definition
SELECT * FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'hydi_events'
ORDER BY ordinal_position;
