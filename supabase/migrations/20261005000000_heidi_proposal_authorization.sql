-- HEIDI PROPOSAL AUTHORIZATION — consume-once bridge evidence.
--
-- An approved proposal records the human decision (decided_by/at +
-- approved_hash). This column marks the separate, later fact that the
-- daemon's authorization gate CONSUMED that approval to authorize the
-- exact bound action once: the conditional UPDATE in
-- ActionProposals.consumeProposalAuthorization sets it atomically while
-- re-checking status='approved', capability_id, params_hash, goal_id and
-- this column being NULL — two concurrent attempts can never both win.
--
-- APPROVED ≠ AUTHORIZED: status stays 'approved'; this timestamp is the
-- authorization evidence, not a status change.
--
-- Effect on the local database (when applied):
--   + heidi_action_proposals.authorization_consumed_at (nullable)
-- No existing tables or rows are touched.

ALTER TABLE public.heidi_action_proposals
  ADD COLUMN IF NOT EXISTS authorization_consumed_at timestamptz;

COMMENT ON COLUMN public.heidi_action_proposals.authorization_consumed_at IS
  'Set when the daemon authorization gate consumes this approval to authorize the bound action — consume-once, atomic, race-safe.';
