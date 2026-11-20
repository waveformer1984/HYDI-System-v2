-- MakeReady Bot: builder lot requests (public intake via service role API only)

CREATE TABLE IF NOT EXISTS public.makeready_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
  company_slug TEXT NOT NULL,
  builder_company TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  community TEXT,
  lot_number TEXT NOT NULL,
  address TEXT NOT NULL,
  phases JSONB NOT NULL DEFAULT '[]'::jsonb,
  sq_ft INTEGER NOT NULL CHECK (sq_ft > 0),
  stories INTEGER NOT NULL DEFAULT 1 CHECK (stories > 0),
  target_date DATE,
  closing_date DATE,
  po_number TEXT,
  notes TEXT,
  access_redacted BOOLEAN NOT NULL DEFAULT false,
  estimate_cents INTEGER,
  estimate_breakdown JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS makeready_requests_request_id_idx ON public.makeready_requests (request_id);
CREATE INDEX IF NOT EXISTS makeready_requests_slug_created_idx ON public.makeready_requests (company_slug, created_at DESC);

ALTER TABLE public.makeready_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS makeready_requests_service_role ON public.makeready_requests;
CREATE POLICY makeready_requests_service_role ON public.makeready_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);