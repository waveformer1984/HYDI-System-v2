-- ============================================================================
-- REZONATE RIGHTS & FINGERPRINTING SCHEMA
-- Adds audio fingerprinting and ownership-claim tables to support content
-- rights management on the Rezonate music platform.
-- Depends on: 20260522000001_rezonate_schema.sql (rezonate_projects,
--             rezonate_audio_files)
-- ============================================================================

-- ============================================================================
-- 1. FINGERPRINTS
-- Acoustic fingerprint records derived from audio files or projects.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_fingerprints (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID          REFERENCES rezonate_projects(id)    ON DELETE SET NULL,
  audio_file_id    UUID          REFERENCES rezonate_audio_files(id) ON DELETE SET NULL,
  hash             TEXT          NOT NULL UNIQUE,
  chroma_vector    DECIMAL[]     DEFAULT '{}',
  spectral_hash    TEXT,
  duration_seconds DECIMAL(10,3),
  submitted_by     UUID          REFERENCES auth.users(id),
  submitted_at     TIMESTAMPTZ   DEFAULT NOW()
);

COMMENT ON TABLE rezonate_fingerprints IS
  'Rezonate – acoustic fingerprint derived from a project or audio file. '
  'hash is the canonical deduplication key; chroma_vector stores the '
  'chromagram for similarity lookups.';

-- ============================================================================
-- 2. OWNERSHIP CLAIMS
-- Records who owns (or disputes ownership of) a fingerprinted work.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_ownership (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_id UUID         REFERENCES rezonate_fingerprints(id) ON DELETE CASCADE,
  owner_id       UUID         REFERENCES auth.users(id),
  owner_name     TEXT,
  status         TEXT         CHECK (status IN ('verified', 'unverified', 'disputed'))
                              DEFAULT 'unverified',
  claim_evidence JSONB        DEFAULT '{}',
  registered_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (fingerprint_id, owner_id)
);

COMMENT ON TABLE rezonate_ownership IS
  'Rezonate – ownership claim linking a fingerprint to an authenticated user. '
  'status transitions: unverified → verified | disputed. '
  'claim_evidence stores arbitrary JSON proof documents.';

-- ============================================================================
-- INDEXES
-- Cover the hash lookup, composite ownership lookup, and submitted_by queries.
-- ============================================================================

-- rezonate_fingerprints
CREATE INDEX IF NOT EXISTS idx_rezonate_fingerprints_hash
  ON rezonate_fingerprints (hash);

CREATE INDEX IF NOT EXISTS idx_rezonate_fingerprints_submitted_by
  ON rezonate_fingerprints (submitted_by);

-- rezonate_ownership
CREATE INDEX IF NOT EXISTS idx_rezonate_ownership_fingerprint_id
  ON rezonate_ownership (fingerprint_id);

CREATE INDEX IF NOT EXISTS idx_rezonate_ownership_owner_id
  ON rezonate_ownership (owner_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE rezonate_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE rezonate_ownership    ENABLE ROW LEVEL SECURITY;

-- ── rezonate_fingerprints ────────────────────────────────────────────────────
-- Service role: unrestricted.
CREATE POLICY "service_role_full_access_rezonate_fingerprints"
  ON rezonate_fingerprints FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Public read: anyone may look up fingerprints (rights clearance use-case).
CREATE POLICY "public_read_rezonate_fingerprints"
  ON rezonate_fingerprints FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated users: insert fingerprints attributed to their own user_id.
CREATE POLICY "users_insert_rezonate_fingerprints"
  ON rezonate_fingerprints FOR INSERT
  TO authenticated
  WITH CHECK (submitted_by = auth.uid());

-- ── rezonate_ownership ───────────────────────────────────────────────────────
-- Service role: unrestricted.
CREATE POLICY "service_role_full_access_rezonate_ownership"
  ON rezonate_ownership FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Public read: anyone may look up ownership claims.
CREATE POLICY "public_read_rezonate_ownership"
  ON rezonate_ownership FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated users: insert ownership claims for their own user_id.
CREATE POLICY "users_insert_rezonate_ownership"
  ON rezonate_ownership FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());
