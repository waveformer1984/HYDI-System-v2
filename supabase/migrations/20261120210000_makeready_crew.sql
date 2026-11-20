-- MakeReady Crew tablet: operational fields on intake requests (service role API only)

ALTER TABLE public.makeready_requests
  ADD COLUMN IF NOT EXISTS crew_status TEXT NOT NULL DEFAULT 'new'
    CHECK (crew_status IN ('new', 'scheduled', 'in_progress', 'done')),
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS crew_label TEXT,
  ADD COLUMN IF NOT EXISTS crew_notes TEXT,
  ADD COLUMN IF NOT EXISTS completion_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS makeready_requests_crew_status_idx
  ON public.makeready_requests (company_slug, crew_status, created_at DESC);