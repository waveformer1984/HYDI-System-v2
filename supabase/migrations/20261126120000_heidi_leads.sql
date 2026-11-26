-- heidi_leads: scored construction-cleanup leads for Heidi lead sweep (NOT applied in cloud prep).

CREATE TABLE IF NOT EXISTS public.heidi_leads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,
  title       text NOT NULL,
  url         text NOT NULL,
  location    text,
  posted_at   timestamptz,
  score       numeric(4, 3),
  title_hash  text NOT NULL,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'approved', 'rejected', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS heidi_leads_source_url_title_hash_idx
  ON public.heidi_leads (source, url, title_hash);

CREATE INDEX IF NOT EXISTS heidi_leads_score_created_idx
  ON public.heidi_leads (score DESC NULLS LAST, created_at DESC);

ALTER TABLE public.heidi_leads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'heidi_leads'
      AND policyname = 'heidi_leads_service_role'
  ) THEN
    CREATE POLICY heidi_leads_service_role ON public.heidi_leads
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;