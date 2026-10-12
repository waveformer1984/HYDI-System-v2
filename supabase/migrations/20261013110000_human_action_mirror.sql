-- Human-action mirror: durable DB projection of the file-backed store.
--
-- data/human-actions.json remains the source of truth and the offline
-- fallback — the detector, resolvers, verifier, and chat surfaces all
-- keep working with the database down. This table is the queryable
-- evidence copy: one row per action, upserted on every mutation and
-- bulk-refreshed each resolver sweep, so a row written while the DB
-- was dead appears on the next live pass.
--
-- Named *_mirror deliberately: reads must never treat this as
-- authoritative. The file store owns truth; this is the audit surface.

CREATE TABLE IF NOT EXISTS human_action_mirror (
  id TEXT PRIMARY KEY,                       -- ha_xxx action id from the file store
  blocker_key TEXT,
  type TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,                      -- OPEN | CLAIMED | VERIFYING | BLOCKED | RESOLVED | REJECTED | EXPIRED | CANCELLED
  priority TEXT,
  owner TEXT,
  source TEXT,
  source_mission_id TEXT,
  source_goal_id TEXT,
  source_agent_id TEXT,
  boundary JSONB,                            -- canonical boundary contract
  verifier JSONB,                            -- {name, spec}
  verification JSONB,                        -- last VerificationResult
  resolution TEXT,                           -- 'auto_verified' | 'human_attested'
  resolver JSONB,                            -- resolution contract + attempts
  expected_outcome TEXT,
  resume_capability TEXT,
  evidence JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  resume_policy TEXT,
  context JSONB,
  transitions JSONB,                         -- append-only audit trail, mirrored whole
  action_created_at TIMESTAMPTZ,             -- the record's own timestamps
  action_updated_at TIMESTAMPTZ,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when this row last synced
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS human_action_mirror_status_idx
  ON human_action_mirror (status);
CREATE INDEX IF NOT EXISTS human_action_mirror_blocker_key_idx
  ON human_action_mirror (blocker_key);

ALTER TABLE human_action_mirror ENABLE ROW LEVEL SECURITY;

-- Evidence is written and read by the service role only — same trust
-- boundary as heidi_events and heidi_operator_lease.
DROP POLICY IF EXISTS human_action_mirror_service_role ON human_action_mirror;
CREATE POLICY human_action_mirror_service_role ON human_action_mirror
  FOR ALL TO service_role USING (true) WITH CHECK (true);
