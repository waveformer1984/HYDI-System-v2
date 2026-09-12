-- ============================================================================
-- HYDI Mission Runner v1 — protoforge.daily_opportunity_scan
--
-- Gives Heidi one concrete operational mission: find real, public,
-- permitted-to-read signals relevant to an actual ProtoForge product
-- (Rezonate first), turn them into structured opportunity records with
-- evidence, score them, persist them locally, and produce a daily brief --
-- instead of another synthetic health check proving isHealthy() returns
-- true.
--
-- Autonomy boundary (see docs/AUTONOMY_BOUNDARY.md if present, and
-- lib/missions/README.md for this mission's own restatement of it):
--   R0 observe / R1 research+classify+prepare -- everything this schema
--   stores is R0/R1 output. Nothing here authorizes R2+ (external contact,
--   spending, commitments). approval_status starts 'pending' and NOTHING
--   in this migration or the mission code flips it to 'approved' --
--   that requires an explicit human action against the approve/reject API.
--
-- Two tables:
--   protoforge_opportunities  -- one row per deduplicated discovered signal
--   protoforge_mission_runs   -- one row per mission execution (evidence
--                                 that a run happened, what it found, and
--                                 whether it succeeded -- mirrors the
--                                 system_health_runs producer pattern from
--                                 20260915180000_dashboard_read_purity.sql
--                                 so this mission is provable, not a chat
--                                 response that evaporates).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.protoforge_opportunities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission           text NOT NULL DEFAULT 'protoforge.daily_opportunity_scan',
  product           text NOT NULL,                 -- 'rezonate', 'forge_finder', 'switchboard', ...
  dedup_hash        text NOT NULL,                  -- sha256 of normalized source_url (or title+source when no URL)
  title             text NOT NULL,
  why_it_matters    text,
  required_action   text,
  estimated_value   text,                           -- human-readable; v1 never fabricates a dollar figure
  confidence        numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  status            text NOT NULL DEFAULT 'needs_review'
                      CHECK (status IN ('high_confidence', 'needs_review', 'rejected')),
  approval_status   text NOT NULL DEFAULT 'pending'
                      CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by       text,
  approved_at       timestamptz,
  source_type       text NOT NULL,                  -- 'hn_algolia' | 'reddit_public' | ...
  evidence          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{source_url, snippet, fetched_at, raw_score}]
  scoring_detail    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- the deterministic factors that produced `confidence`
  discovered_at     timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedup_hash)
);

CREATE INDEX IF NOT EXISTS idx_protoforge_opportunities_status ON public.protoforge_opportunities (status);
CREATE INDEX IF NOT EXISTS idx_protoforge_opportunities_approval ON public.protoforge_opportunities (approval_status);
CREATE INDEX IF NOT EXISTS idx_protoforge_opportunities_confidence ON public.protoforge_opportunities (confidence DESC);
CREATE INDEX IF NOT EXISTS idx_protoforge_opportunities_product ON public.protoforge_opportunities (product);
CREATE INDEX IF NOT EXISTS idx_protoforge_opportunities_discovered_at ON public.protoforge_opportunities (discovered_at DESC);

CREATE TABLE IF NOT EXISTS public.protoforge_mission_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission               text NOT NULL DEFAULT 'protoforge.daily_opportunity_scan',
  run_at                timestamptz NOT NULL DEFAULT now(),
  status                text NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  sources_queried       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{source_type, query, ok, item_count, error}]
  opportunities_found   integer NOT NULL DEFAULT 0,           -- new, non-duplicate rows this run
  duplicates_skipped    integer NOT NULL DEFAULT 0,
  high_confidence_count integer NOT NULL DEFAULT 0,
  needs_review_count    integer NOT NULL DEFAULT 0,
  rejected_count        integer NOT NULL DEFAULT 0,
  briefing_text         text,
  error                 text,
  duration_ms           integer,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_protoforge_mission_runs_run_at ON public.protoforge_mission_runs (run_at DESC);

-- Idempotent trigger to keep updated_at honest on approve/reject writes.
CREATE OR REPLACE FUNCTION public.protoforge_opportunities_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protoforge_opportunities_updated_at ON public.protoforge_opportunities;
CREATE TRIGGER trg_protoforge_opportunities_updated_at
  BEFORE UPDATE ON public.protoforge_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.protoforge_opportunities_set_updated_at();

-- RLS: service_role only, matching the existing `leads` table convention
-- (supabase/migrations -- see \d leads policies). No anon/authenticated
-- access; these routes are reached through server-side API code that
-- authenticates the caller itself (verifyServiceToken), not client-side
-- Supabase queries.
ALTER TABLE public.protoforge_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS protoforge_opportunities_service_role ON public.protoforge_opportunities;
CREATE POLICY protoforge_opportunities_service_role ON public.protoforge_opportunities
  TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.protoforge_mission_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS protoforge_mission_runs_service_role ON public.protoforge_mission_runs;
CREATE POLICY protoforge_mission_runs_service_role ON public.protoforge_mission_runs
  TO service_role USING (true) WITH CHECK (true);
