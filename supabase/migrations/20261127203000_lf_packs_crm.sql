-- Lead Forge CRM persistence (lf_*): pack import from lead-forge/packs/<id>/.
-- NOT applied in cloud prep — local/service_role import path only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lf_packs (
  id                TEXT PRIMARY KEY,
  niche             TEXT NOT NULL,
  city              TEXT NOT NULL,
  radius            INTEGER NOT NULL CHECK (radius > 0 AND radius <= 100),
  requested_count   INTEGER NOT NULL CHECK (requested_count >= 1 AND requested_count <= 500),
  lead_count        INTEGER NOT NULL DEFAULT 0 CHECK (lead_count >= 0),
  source_errors     JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_status   TEXT NOT NULL DEFAULT 'awaiting_jordan_approval',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lf_packs_created_at_idx ON public.lf_packs (created_at DESC);
CREATE INDEX IF NOT EXISTS lf_packs_niche_idx ON public.lf_packs (niche);

CREATE TABLE IF NOT EXISTS public.lf_leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id         TEXT NOT NULL REFERENCES public.lf_packs (id) ON DELETE CASCADE,
  business_name   TEXT NOT NULL,
  category        TEXT,
  address         TEXT,
  phone           TEXT,
  website         TEXT,
  email           TEXT,
  rating          NUMERIC(3, 2),
  review_count    INTEGER,
  signals         TEXT[] NOT NULL DEFAULT '{}'::text[],
  fit_score       INTEGER CHECK (fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100)),
  fit_reasons     TEXT[] NOT NULL DEFAULT '{}'::text[],
  email_1         TEXT,
  email_2         TEXT,
  email_3         TEXT,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'reviewed', 'approved', 'contacted', 'replied', 'won', 'lost', 'do_not_contact'
  )),
  notes           TEXT,
  next_follow_up  DATE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lf_leads_pack_id_idx ON public.lf_leads (pack_id);
CREATE INDEX IF NOT EXISTS lf_leads_status_idx ON public.lf_leads (status);
CREATE INDEX IF NOT EXISTS lf_leads_fit_score_idx ON public.lf_leads (fit_score DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.lf_activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES public.lf_leads (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('note', 'status_change', 'draft_edit', 'suppressed')),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lf_activities_lead_id_idx ON public.lf_activities (lead_id, created_at DESC);

ALTER TABLE public.lf_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lf_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lf_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lf_packs_service_role ON public.lf_packs;
DROP POLICY IF EXISTS lf_leads_service_role ON public.lf_leads;
DROP POLICY IF EXISTS lf_activities_service_role ON public.lf_activities;

DO $$ BEGIN
  CREATE POLICY lf_packs_service_role ON public.lf_packs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY lf_leads_service_role ON public.lf_leads
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY lf_activities_service_role ON public.lf_activities
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lf_packs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lf_leads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lf_activities TO service_role;

COMMIT;

-- DOWN (manual rollback — not executed by migration runner):
-- BEGIN;
-- DROP TABLE IF EXISTS public.lf_activities;
-- DROP TABLE IF EXISTS public.lf_leads;
-- DROP TABLE IF EXISTS public.lf_packs;
-- COMMIT;