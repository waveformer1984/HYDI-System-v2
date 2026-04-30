-- Create pending_tasks table for UniversalAgentBus message recovery
CREATE TABLE IF NOT EXISTS public.pending_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id uuid NOT NULL,
  origin text NOT NULL,
  target text NOT NULL,
  action text NOT NULL,
  payload jsonb,
  priority integer DEFAULT 1,
  ttl integer DEFAULT 30000,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '30 seconds'),
  status text DEFAULT 'pending',
  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 3,
  last_attempt timestamptz,
  error_message text,
  CONSTRAINT pending_tasks_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired'))
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_pending_tasks_status ON public.pending_tasks(status);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_expires_at ON public.pending_tasks(expires_at);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_priority ON public.pending_tasks(priority DESC);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_created_at ON public.pending_tasks(created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE public.pending_tasks ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (allow service role full access for now)
CREATE POLICY "Service role full access to pending_tasks" ON public.pending_tasks
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Add comments for documentation
COMMENT ON TABLE public.pending_tasks IS 'Message recovery queue for UniversalAgentBus in-flight messages';
COMMENT ON COLUMN public.pending_tasks.priority IS 'Message priority (higher = more important)';
COMMENT ON COLUMN public.pending_tasks.ttl IS 'Time-to-live in milliseconds';
COMMENT ON COLUMN public.pending_tasks.expires_at IS 'When this message expires and should be cleaned up';
COMMENT ON COLUMN public.pending_tasks.status IS 'Current state: pending, processing, completed, failed, expired';
COMMENT ON COLUMN public.pending_tasks.attempts IS 'Number of retry attempts made';
COMMENT ON COLUMN public.pending_tasks.max_attempts IS 'Maximum retry attempts before giving up';
