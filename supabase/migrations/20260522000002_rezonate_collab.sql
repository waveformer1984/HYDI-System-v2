-- ============================================================================
-- REZONATE COLLABORATION SCHEMA
-- Adds real-time collaboration sessions, participant contribution tracking,
-- and an append-only CRDT event log for the Rezonate music platform.
-- Depends on: 20260522000001_rezonate_schema.sql (rezonate_projects)
-- ============================================================================

-- ============================================================================
-- 1. COLLAB SESSIONS
-- A real-time collaboration session tied to a project.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_collab_sessions (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID         REFERENCES rezonate_projects(id) ON DELETE CASCADE,
  name             TEXT         NOT NULL,
  status           TEXT         CHECK (status IN ('open', 'locked', 'closed')) DEFAULT 'open',
  max_participants INT          DEFAULT 8,
  created_by       UUID         REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  closed_at        TIMESTAMPTZ
);

COMMENT ON TABLE rezonate_collab_sessions IS
  'Rezonate – a real-time collaboration session linked to a project. '
  'Status controls whether new participants may join.';

-- ============================================================================
-- 2. COLLAB CONTRIBUTIONS
-- Tracks which users participated in a session and their contribution weight.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_collab_contributions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID         REFERENCES rezonate_collab_sessions(id) ON DELETE CASCADE,
  user_id      UUID         REFERENCES auth.users(id),
  display_name TEXT         NOT NULL,
  pad_indices  INTEGER[]    DEFAULT '{}',   -- which pads this user recorded
  event_count  INT          DEFAULT 0,
  joined_at    TIMESTAMPTZ  DEFAULT NOW(),
  left_at      TIMESTAMPTZ,
  UNIQUE (session_id, user_id)
);

COMMENT ON TABLE rezonate_collab_contributions IS
  'Rezonate – records which users joined a collab session, the pads they '
  'recorded, and their total event contribution count.';

-- ============================================================================
-- 3. COLLAB EVENTS
-- Append-only event log (CRDT source of truth for collaborative state).
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_collab_events (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID         REFERENCES rezonate_collab_sessions(id) ON DELETE CASCADE,
  user_id    UUID         REFERENCES auth.users(id),
  event_type TEXT         NOT NULL
                          CHECK (event_type IN (
                            'pad_record', 'pad_clear', 'pad_loop_toggle',
                            'bpm_change', 'play', 'stop'
                          )),
  payload    JSONB        NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON TABLE rezonate_collab_events IS
  'Rezonate – append-only CRDT event log for a collaboration session. '
  'Each row captures a single user action; replaying rows in created_at '
  'order fully reconstructs session state.';

-- ============================================================================
-- INDEXES
-- Cover session_id (most common join), user_id, and created_at ordering.
-- ============================================================================

-- rezonate_collab_contributions
CREATE INDEX IF NOT EXISTS idx_rezonate_collab_contributions_session_id
  ON rezonate_collab_contributions (session_id);

CREATE INDEX IF NOT EXISTS idx_rezonate_collab_contributions_user_id
  ON rezonate_collab_contributions (user_id);

-- rezonate_collab_events
CREATE INDEX IF NOT EXISTS idx_rezonate_collab_events_session_id
  ON rezonate_collab_events (session_id);

CREATE INDEX IF NOT EXISTS idx_rezonate_collab_events_created_at
  ON rezonate_collab_events (created_at);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE rezonate_collab_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rezonate_collab_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rezonate_collab_events        ENABLE ROW LEVEL SECURITY;

-- ── rezonate_collab_sessions ─────────────────────────────────────────────────
-- Service role: unrestricted (Edge Functions and billing pipeline).
CREATE POLICY "service_role_full_access_rezonate_collab_sessions"
  ON rezonate_collab_sessions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: read/insert sessions they are part of (via contributions).
CREATE POLICY "users_read_rezonate_collab_sessions"
  ON rezonate_collab_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM rezonate_collab_contributions c
      WHERE c.session_id = id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "users_insert_rezonate_collab_sessions"
  ON rezonate_collab_sessions FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- ── rezonate_collab_contributions ────────────────────────────────────────────
CREATE POLICY "service_role_full_access_rezonate_collab_contributions"
  ON rezonate_collab_contributions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: read contributions for sessions they are in.
CREATE POLICY "users_read_rezonate_collab_contributions"
  ON rezonate_collab_contributions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM rezonate_collab_contributions c
      WHERE c.session_id = session_id AND c.user_id = auth.uid()
    )
  );

-- Authenticated users: insert their own contribution row.
CREATE POLICY "users_insert_rezonate_collab_contributions"
  ON rezonate_collab_contributions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── rezonate_collab_events ───────────────────────────────────────────────────
CREATE POLICY "service_role_full_access_rezonate_collab_events"
  ON rezonate_collab_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Events are insert-only for authenticated users who are session participants.
CREATE POLICY "users_insert_rezonate_collab_events"
  ON rezonate_collab_events FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM rezonate_collab_contributions c
      WHERE c.session_id = session_id AND c.user_id = auth.uid()
    )
  );

-- Authenticated users may read events for sessions they participated in.
CREATE POLICY "users_read_rezonate_collab_events"
  ON rezonate_collab_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM rezonate_collab_contributions c
      WHERE c.session_id = session_id AND c.user_id = auth.uid()
    )
  );
