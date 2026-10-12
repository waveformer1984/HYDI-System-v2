-- HEIDI OPERATOR LEASE — one durable claim row per operator.
--
-- The daemon's file lock (.heidi-daemon.lock) is a same-filesystem guard;
-- it cannot answer "which operator instance owns the loop right now?" for
-- anything reading the database — and it cannot outlive its own machine's
-- view of itself. This table is the durable version: one row per operator
-- name, claimed atomically, heartbeated while the holder works, expired by
-- time alone (a crashed holder's lease dies on schedule without any
-- cleanup having to run).
--
-- Claim protocol (implemented in lib/heidi/OperatorLease.ts):
--   INSERT … ON CONFLICT (operator) DO UPDATE …
--   WHERE expires_at < now() OR released_at IS NOT NULL
-- A second claimant while a live lease exists gets 0 rows back — refused,
-- atomically, with no read-then-write race. The incumbent heartbeats by
-- owner-scoped UPDATE (owner_id must match); a superseded holder's
-- heartbeat silently writes 0 rows, which is how it learns it lost.
--
-- Effect on the local database (when applied):
--   + table public.heidi_operator_lease
--   + unique index on operator (one live lease row per operator)
--   + index on expires_at for stale-lease scans
-- No existing tables or rows are touched.

CREATE TABLE IF NOT EXISTS public.heidi_operator_lease (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator    text        NOT NULL,
  owner_id    text        NOT NULL,
  host        text,
  pid         integer,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  released_at timestamptz,
  meta        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS heidi_operator_lease_operator_key
  ON public.heidi_operator_lease (operator);

CREATE INDEX IF NOT EXISTS heidi_operator_lease_expires_at_idx
  ON public.heidi_operator_lease (expires_at);

COMMENT ON TABLE public.heidi_operator_lease IS
  'Durable single-holder lease per operator. Claim is a conditional upsert; refusal is atomic. expires_at < now() means stale — the holder is presumed dead.';
COMMENT ON COLUMN public.heidi_operator_lease.owner_id IS
  'Unique claim identity for this holder (boot id / pid+host token). Heartbeats and releases must match it — a superseded holder cannot write.';
COMMENT ON COLUMN public.heidi_operator_lease.released_at IS
  'Set on voluntary release. NULL + expires_at < now() = stale (involuntary loss), distinct from a clean handoff.';

-- RLS: service_role only, matching the heidi_missions convention.
ALTER TABLE public.heidi_operator_lease ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS heidi_operator_lease_service_role ON public.heidi_operator_lease;
CREATE POLICY heidi_operator_lease_service_role ON public.heidi_operator_lease
  TO service_role USING (true) WITH CHECK (true);
