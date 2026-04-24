-- Create webhook_events table if it doesn't exist
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text UNIQUE NOT NULL,
  event_type text NOT NULL,
  processed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  error_message text,
  payload jsonb NOT NULL
);

-- Enable RLS
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Service role policy
CREATE POLICY IF NOT EXISTS "service_role_all" ON webhook_events
  FOR ALL USING (auth.role() = 'service_role');
