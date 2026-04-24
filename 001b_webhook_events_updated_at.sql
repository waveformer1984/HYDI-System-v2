-- Add updated_at to webhook_events
ALTER TABLE public.webhook_events 
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
