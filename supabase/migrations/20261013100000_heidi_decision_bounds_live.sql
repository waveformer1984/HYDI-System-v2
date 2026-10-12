-- Live authority bounds for unattended resolver execution.
--
-- heidi_decision_bounds has existed since the legacy event-loop schema
-- (20260626130000) but no code ever read it — unattended authority was a
-- static claim compiled into resolver-policy.js. This migration turns
-- the table into the live, owner-revocable bound the resolver sweep
-- consults on every attempt:
--
--   unattended_enabled  — kill all unattended resolver execution via
--                         SQL, no deploy required
--   denied_resolvers    — per-resolver revocation by resolverId
--   denied_capabilities — per-capability revocation by capability key
--
-- Additive only: existing rows keep their semantics, the new columns
-- default to the previous implicit behaviour (enabled, nothing denied).
-- HEIDI_ALLOW_EXEC remains the environment-side master switch — this
-- table is the bounds side of the same gate.

ALTER TABLE heidi_decision_bounds
  ADD COLUMN IF NOT EXISTS unattended_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE heidi_decision_bounds
  ADD COLUMN IF NOT EXISTS denied_resolvers TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE heidi_decision_bounds
  ADD COLUMN IF NOT EXISTS denied_capabilities TEXT[] NOT NULL DEFAULT '{}';

-- Keep updated_at honest on bounds edits.
CREATE OR REPLACE FUNCTION heidi_decision_bounds_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS heidi_decision_bounds_touch ON heidi_decision_bounds;
CREATE TRIGGER heidi_decision_bounds_touch
  BEFORE UPDATE ON heidi_decision_bounds
  FOR EACH ROW EXECUTE FUNCTION heidi_decision_bounds_touch();
