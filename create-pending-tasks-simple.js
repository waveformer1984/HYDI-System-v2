const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://akbnfovjdcobifeupvbn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE'
);

const sql = `CREATE TABLE IF NOT EXISTS public.pending_tasks (
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

CREATE INDEX IF NOT EXISTS idx_pending_tasks_status ON public.pending_tasks(status);`;

console.log('Creating pending_tasks table...');

fetch('https://akbnfovjdcobifeupvbn.supabase.co/rest/v1/rpc/exec_sql', {
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
    console.error('Error:', error);
  } else {
    console.log('Table created successfully');
  }
})
.catch(console.error);
