-- ============================================================================
-- HYDI Mission Integrity — heidi_missions (Slice 1: durable mission record
-- + atomic claim foundation)
--
-- Goals are intent; missions are execution instances. Today a mission's only
-- durable record is its mission_transition receipts in heidi_events, keyed by
-- a missionId that for ~62% of 24h volume (capability invocations minted by
-- supervisor producers) never resolves to a heidi_goals row. This table gives
-- every execution a durable row so claiming, attempts, and later
-- fencing/recovery have something real to point at.
--
-- Design contract (see remediation plan v3):
--   - idempotency_key UNIQUE: sha256(work_identity) where work_identity =
--     (goal_id | producer_key) | capability_id | params_hash | work_slot.
--     Retries of the same logical work reuse the row; an intentional new run
--     uses a new work_slot -> new key -> new row. Never includes attempt.
--   - claim_generation is monotonic, incremented on every claim/re-claim —
--     the fencing token later slices will check on every conditional write.
--   - status lifecycle: planned|claimed|running|verifying (transitional),
--     waiting_human (non-terminal human handoff — never swept),
--     succeeded|failed|cancelled|timed_out (terminal).
--   - Resume path columns (awaiting_approval_ref, authorized_by/at,
--     resume_count) are created now but UNUSED until the governed-resume
--     slice lands — keeping them out would require a second migration
--     touching the same table.
--   - heidi_goals is untouched: goal status stays intent-level; mission
--     status is execution-level. Mission ids are independent UUIDs — one
--     goal can produce multiple mission rows when the logical work keys
--     differ (idempotency_key uniqueness is on the key, not goal_id).
--     Receipt missionId links to this row's id; goal linkage is via
--     goal_id, so readers join events→missions→goals. Legacy receipts
--     whose missionId equals a goal id remain valid historical evidence.
--
-- RLS: service_role only, matching the protoforge_opportunities convention.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.heidi_missions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id               uuid REFERENCES public.heidi_goals(id),
  parent_mission        uuid REFERENCES public.heidi_missions(id),
  idempotency_key       text NOT NULL,
  producer_key          text NOT NULL,
  capability_id         text,
  params_hash           text,
  status                text NOT NULL DEFAULT 'planned'
                          CHECK (status IN (
                            'planned', 'claimed', 'running', 'verifying',
                            'waiting_human',
                            'succeeded', 'failed', 'cancelled', 'timed_out'
                          )),
  stage                 text,
  attempt               integer NOT NULL DEFAULT 0,
  claim_generation      integer NOT NULL DEFAULT 0,
  claimed_by            text,
  claimed_at            timestamptz,
  lease_expires_at      timestamptz,
  failure_class         text CHECK (
                          failure_class IS NULL OR
                          failure_class IN ('transient', 'deterministic', 'governance')
                        ),
  -- Governed human-resume path (wired up in a later slice; columns exist now
  -- so no second migration touches this table).
  awaiting_approval_ref uuid REFERENCES public.human_intervention_requests(id),
  authorized_by         text,
  authorized_at         timestamptz,
  resume_count          integer NOT NULL DEFAULT 0,
  result_summary        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_heidi_missions_goal_id ON public.heidi_missions (goal_id);
CREATE INDEX IF NOT EXISTS idx_heidi_missions_status_open
  ON public.heidi_missions (status)
  WHERE status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out');
CREATE INDEX IF NOT EXISTS idx_heidi_missions_lease
  ON public.heidi_missions (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_heidi_missions_producer ON public.heidi_missions (producer_key);

-- updated_at trigger, idempotent (same convention as protoforge_opportunities)
CREATE OR REPLACE FUNCTION public.heidi_missions_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_heidi_missions_updated_at ON public.heidi_missions;
CREATE TRIGGER trg_heidi_missions_updated_at
  BEFORE UPDATE ON public.heidi_missions
  FOR EACH ROW EXECUTE FUNCTION public.heidi_missions_set_updated_at();

ALTER TABLE public.heidi_missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS heidi_missions_service_role ON public.heidi_missions;
CREATE POLICY heidi_missions_service_role ON public.heidi_missions
  TO service_role USING (true) WITH CHECK (true);
