-- Phase 5: first-class divisions table.
-- The 10 HYDI divisions were previously only implied by string columns.
-- This table makes them addressable rows; seeds live in
-- scripts/seed-divisions.js (idempotent, placeholder content marked
-- TODO(owner) — no invented business facts).

CREATE TABLE IF NOT EXISTS public.divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'seeded'
    CHECK (status IN ('seeded', 'active', 'dormant', 'archived')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS divisions_slug_idx ON public.divisions (slug);

ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;

-- Read access for service_role only; writes go through the seed script
-- (service role) — no anon/authenticated policies by design.
DROP POLICY IF EXISTS divisions_service_role_all ON public.divisions;
DO $$ BEGIN
  CREATE POLICY divisions_service_role_all ON public.divisions
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.touch_divisions_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS divisions_touch_updated_at ON public.divisions;
CREATE TRIGGER divisions_touch_updated_at
  BEFORE UPDATE ON public.divisions
  FOR EACH ROW EXECUTE FUNCTION public.touch_divisions_updated_at();
