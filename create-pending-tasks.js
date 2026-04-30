const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://akbnfovjdcobifeupvbn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE'
);

const sql = `
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

CREATE INDEX IF NOT EXISTS idx_pending_tasks_status ON public.pending_tasks(status);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_expires_at ON public.pending_tasks(expires_at);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_priority ON public.pending_tasks(priority DESC);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_created_at ON public.pending_tasks(created_at);

ALTER TABLE public.pending_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role full access to pending_tasks" ON public.pending_tasks
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
`;

console.log('Creating pending_tasks table...');

// Use raw SQL through the client
supabase
  .from('pending_tasks')
  .select('*')
  .limit(1)
  .then(({ data, error }) => {
    if (error && error.code === 'PGRST116') {
      // Table doesn't exist, need to create it via SQL
      console.log('Table does not exist, attempting to create...');
      
      // Try using the REST API directly
      return fetch('https://akbnfovjdcobifeupvbn.supabase.co/rest/v1/rpc/execute_sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE'
        },
        body: JSON.stringify({ sql_query: sql })
      })
      .then(res => res.json())
      .then(({ data, error }) => {
        if (error) {
          console.error('Direct SQL failed:', error);
        } else {
          console.log('Table created successfully via direct SQL');
        }
      });
    } else if (!error) {
      console.log('Table already exists');
    } else {
      console.error('Unexpected error:', error);
    }
  })
  .catch(console.error);
