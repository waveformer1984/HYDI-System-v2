-- HEIDI ACTION PROPOSALS — governed human-approval surface for chat.
--
-- A proposal is a durable, server-side-authored record of an action Heidi
-- recommends. The browser can only submit a proposal id + a decision;
-- capability and parameters are resolved exclusively from THIS table
-- (never from the request body), and approval is bound to params_hash so
-- a changed proposal can never be executed under a stale approval.
--
-- Approve consumes the row atomically (status 'pending' -> 'approved'
-- with the exact approved_hash) and inserts a pending heidi_goals mission
-- row in the same transaction. Execution then flows through the existing
-- daemon planner -> MissionRunner -> MissionLedger path: durable claim,
-- fenced transitions, receipts. This table adds no execution authority —
-- it is a gate, not a path.
--
-- Effect on the local database (when applied):
--   + public.heidi_action_proposals (RLS, service_role-only)
--   + 3 indexes, 1 partial unique dedupe index
--   + trg_heidi_action_proposals_updated_at trigger
-- No existing tables or rows are touched.

CREATE TABLE IF NOT EXISTS public.heidi_action_proposals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version         integer NOT NULL DEFAULT 1,
  -- What will run. capability_id must be in the server-side allowlist
  -- (lib/heidi/ActionProposals.ts PROPOSAL_ALLOWLIST); enforced on write,
  -- re-validated on consume.
  capability_id   text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- sha256(capability_id + ':' + canonicalJson(params)) — the approval is
  -- bound to exactly this. Any post-approval change fails the consume.
  params_hash     text NOT NULL,
  -- Plain-language fields the UI renders verbatim.
  title           text NOT NULL,
  reason          text NOT NULL,                    -- what & why
  expected_effects text,
  risks           text,
  prerequisites   text,
  rollback        text,                             -- recovery steps, if any
  reversible      boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected',
                                    'expired','retracted')),
  producer_key    text NOT NULL,                    -- dedupe identity
  expires_at      timestamptz NOT NULL,             -- proposal validity window
  decided_by      text,                             -- approver identity (role/device)
  decided_at      timestamptz,
  approved_hash   text,                             -- params_hash at approve time
  goal_id         uuid REFERENCES public.heidi_goals(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heidi_proposals_status
  ON public.heidi_action_proposals (status);
CREATE INDEX IF NOT EXISTS idx_heidi_proposals_expires
  ON public.heidi_action_proposals (expires_at);
CREATE INDEX IF NOT EXISTS idx_heidi_proposals_goal
  ON public.heidi_action_proposals (goal_id);

-- Dedupe: at most one pending proposal per (producer_key, params_hash).
-- A consumed/rejected/expired row never blocks a fresh proposal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_heidi_proposals_pending_dedupe
  ON public.heidi_action_proposals (producer_key, params_hash)
  WHERE status = 'pending';

ALTER TABLE public.heidi_action_proposals ENABLE ROW LEVEL SECURITY;

-- Service role only — proposals are server-authored; the browser reaches
-- them exclusively through the authenticated API surface.
DROP POLICY IF EXISTS "heidi_proposals_service_role" ON public.heidi_action_proposals;
CREATE POLICY "heidi_proposals_service_role" ON public.heidi_action_proposals
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.heidi_action_proposals_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_heidi_action_proposals_updated_at ON public.heidi_action_proposals;
CREATE TRIGGER trg_heidi_action_proposals_updated_at
  BEFORE UPDATE ON public.heidi_action_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.heidi_action_proposals_set_updated_at();
