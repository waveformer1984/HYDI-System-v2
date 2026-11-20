-- MakeReady Bot: platform demo / offer leads (public intake via service role API only)

CREATE TABLE IF NOT EXISTS public.makeready_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company_name TEXT,
  message TEXT,
  source TEXT NOT NULL DEFAULT 'makeready-bot-offer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS makeready_leads_lead_id_idx ON public.makeready_leads (lead_id);
CREATE INDEX IF NOT EXISTS makeready_leads_created_idx ON public.makeready_leads (created_at DESC);

ALTER TABLE public.makeready_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS makeready_leads_service_role ON public.makeready_leads;

DO $$ BEGIN
  CREATE POLICY makeready_leads_service_role ON public.makeready_leads
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;