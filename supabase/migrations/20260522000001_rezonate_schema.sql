-- ============================================================================
-- REZONATE MUSIC PLATFORM SCHEMA
-- Creates tables for projects, tracks, patterns, audio files, and processing
-- settings for the Rezonate music creation platform (revenue stream: rezonate).
-- ============================================================================

-- ============================================================================
-- 1. PROJECTS
-- Top-level container for a user's music project.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_projects (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT         NOT NULL,
  tempo          INT          NOT NULL DEFAULT 120,
  time_signature TEXT         NOT NULL DEFAULT '4/4',
  key_signature  TEXT         NOT NULL DEFAULT 'C major',
  description    TEXT,
  status         TEXT         NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'active', 'archived')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rezonate_projects IS
  'Rezonate – top-level music project owned by a single user. '
  'Holds global DAW settings (tempo, key, time signature) and lifecycle status.';

-- ============================================================================
-- 2. TRACKS
-- Ordered audio/MIDI/instrument lanes within a project.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_tracks (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID         NOT NULL REFERENCES rezonate_projects(id) ON DELETE CASCADE,
  name       TEXT         NOT NULL,
  type       TEXT         NOT NULL
                          CHECK (type IN ('audio', 'midi', 'instrument')),
  muted      BOOLEAN      NOT NULL DEFAULT FALSE,
  solo       BOOLEAN      NOT NULL DEFAULT FALSE,
  volume     DECIMAL(4,2) NOT NULL DEFAULT 0.0,
  pan        DECIMAL(4,2) NOT NULL DEFAULT 0.0,
  position   INT          NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rezonate_tracks IS
  'Rezonate – a single audio, MIDI, or virtual-instrument lane within a project. '
  'Position determines render order in the DAW timeline.';

-- ============================================================================
-- 3. PATTERNS
-- Beat/note sequences placed on a track.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_patterns (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id       UUID         NOT NULL REFERENCES rezonate_tracks(id) ON DELETE CASCADE,
  name           TEXT         NOT NULL,
  length_bars    INT          NOT NULL DEFAULT 4,
  start_position INT          NOT NULL DEFAULT 0,
  data           JSONB        NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rezonate_patterns IS
  'Rezonate – a pattern (step-sequence or piano-roll block) placed on a track. '
  'Raw note/step data is stored as JSONB for schema-free extensibility.';

-- ============================================================================
-- 4. AUDIO FILES
-- Uploaded or recorded audio blobs associated with a project/track.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_audio_files (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID          NOT NULL REFERENCES rezonate_projects(id) ON DELETE CASCADE,
  track_id         UUID          REFERENCES rezonate_tracks(id) ON DELETE SET NULL,
  filename         TEXT          NOT NULL,
  file_path        TEXT          NOT NULL,
  storage_bucket   TEXT          NOT NULL DEFAULT 'rezonate-audio',
  duration_seconds DECIMAL(10,3),
  sample_rate      INT,
  bit_depth        INT,
  file_size_bytes  BIGINT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rezonate_audio_files IS
  'Rezonate – audio blobs (WAV, MP3, FLAC) uploaded to Supabase Storage. '
  'track_id is nullable so files can be stored at project level before assignment.';

-- ============================================================================
-- 5. PROCESSING SETTINGS
-- Ordered effects-chain entries for a track (EQ, reverb, compression, etc.).
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_processing_settings (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id    UUID         NOT NULL REFERENCES rezonate_tracks(id) ON DELETE CASCADE,
  effect_type TEXT         NOT NULL,
  parameters  JSONB        NOT NULL DEFAULT '{}',
  enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
  position    INT          NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rezonate_processing_settings IS
  'Rezonate – an effects-chain slot on a track. '
  'position determines signal-chain order; parameters are stored as JSONB '
  'to support arbitrary per-effect configuration.';

-- ============================================================================
-- INDEXES
-- Cover all foreign-key columns and the user_id owner lookup.
-- ============================================================================

-- rezonate_projects
CREATE INDEX IF NOT EXISTS idx_rezonate_projects_user_id
  ON rezonate_projects (user_id);

-- rezonate_tracks
CREATE INDEX IF NOT EXISTS idx_rezonate_tracks_project_id
  ON rezonate_tracks (project_id);

-- rezonate_patterns
CREATE INDEX IF NOT EXISTS idx_rezonate_patterns_track_id
  ON rezonate_patterns (track_id);

-- rezonate_audio_files
CREATE INDEX IF NOT EXISTS idx_rezonate_audio_files_project_id
  ON rezonate_audio_files (project_id);

CREATE INDEX IF NOT EXISTS idx_rezonate_audio_files_track_id
  ON rezonate_audio_files (track_id);

-- rezonate_processing_settings
CREATE INDEX IF NOT EXISTS idx_rezonate_processing_settings_track_id
  ON rezonate_processing_settings (track_id);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- Reuse the shared set_updated_at() function if it already exists in the
-- schema (created by 20260424220000_hdi_chaos_safety_schema.sql); define
-- it here with OR REPLACE so the migration is self-contained and idempotent.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the trigger to rezonate_projects (the only table with updated_at).
CREATE TRIGGER rezonate_projects_set_updated_at
  BEFORE UPDATE ON rezonate_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE rezonate_projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rezonate_tracks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rezonate_patterns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rezonate_audio_files        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rezonate_processing_settings ENABLE ROW LEVEL SECURITY;

-- ── rezonate_projects ────────────────────────────────────────────────────────
-- Service role: unrestricted (needed by Edge Functions and billing pipeline).
CREATE POLICY "service_role_full_access_rezonate_projects"
  ON rezonate_projects FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: CRUD their own projects only.
CREATE POLICY "users_own_rezonate_projects"
  ON rezonate_projects FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── rezonate_tracks ──────────────────────────────────────────────────────────
CREATE POLICY "service_role_full_access_rezonate_tracks"
  ON rezonate_tracks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Access via ownership of the parent project.
CREATE POLICY "users_own_rezonate_tracks"
  ON rezonate_tracks FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM rezonate_projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rezonate_projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

-- ── rezonate_patterns ────────────────────────────────────────────────────────
CREATE POLICY "service_role_full_access_rezonate_patterns"
  ON rezonate_patterns FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Access via ownership of the grandparent project (through track).
CREATE POLICY "users_own_rezonate_patterns"
  ON rezonate_patterns FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM rezonate_tracks t
      JOIN rezonate_projects p ON p.id = t.project_id
      WHERE t.id = track_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM rezonate_tracks t
      JOIN rezonate_projects p ON p.id = t.project_id
      WHERE t.id = track_id AND p.user_id = auth.uid()
    )
  );

-- ── rezonate_audio_files ─────────────────────────────────────────────────────
CREATE POLICY "service_role_full_access_rezonate_audio_files"
  ON rezonate_audio_files FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Access via ownership of the parent project.
CREATE POLICY "users_own_rezonate_audio_files"
  ON rezonate_audio_files FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM rezonate_projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rezonate_projects p
      WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

-- ── rezonate_processing_settings ─────────────────────────────────────────────
CREATE POLICY "service_role_full_access_rezonate_processing_settings"
  ON rezonate_processing_settings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Access via ownership of the grandparent project (through track).
CREATE POLICY "users_own_rezonate_processing_settings"
  ON rezonate_processing_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM rezonate_tracks t
      JOIN rezonate_projects p ON p.id = t.project_id
      WHERE t.id = track_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM rezonate_tracks t
      JOIN rezonate_projects p ON p.id = t.project_id
      WHERE t.id = track_id AND p.user_id = auth.uid()
    )
  );
