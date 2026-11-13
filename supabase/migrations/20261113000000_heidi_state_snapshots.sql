-- heidi_state_snapshots: periodic perceive→record snapshots written by the
-- cognitive loop (CognitiveCore.recordSnapshot). One row per cycle carrying
-- the compact perception + outcome payload. Local Supabase only.
-- RLS mirrors heidi_reflections: service_role full access, authenticated read.

CREATE TABLE IF NOT EXISTS public.heidi_state_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id    text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL DEFAULT 'cognitive-loop',
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heidi_state_snapshots_captured_at
  ON public.heidi_state_snapshots (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_heidi_state_snapshots_cycle_id
  ON public.heidi_state_snapshots (cycle_id);

ALTER TABLE public.heidi_state_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='heidi_state_snapshots'
      AND policyname='heidi_state_snapshots_service_role'
  ) THEN
    CREATE POLICY heidi_state_snapshots_service_role ON public.heidi_state_snapshots
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='heidi_state_snapshots'
      AND policyname='heidi_state_snapshots_read'
  ) THEN
    CREATE POLICY heidi_state_snapshots_read ON public.heidi_state_snapshots
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
