-- ============================================================================
-- REZONATE REVENUE SPLITS SCHEMA
-- Stores per-session revenue split configuration so collaborators can agree
-- on payout percentages before a session is locked and payments are processed.
-- Depends on: 20260522000002_rezonate_collab.sql (rezonate_collab_sessions)
-- ============================================================================

-- ============================================================================
-- UPDATED_AT FUNCTION
-- Reuse the shared set_updated_at() function if it already exists in the
-- schema; CREATE OR REPLACE keeps this migration self-contained and idempotent.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. REVENUE SPLITS
-- One row per collab session; split_config is a JSONB array where each
-- element has the shape:
--   { user_id, display_name, percentage, stripe_account_id }
-- total_percentage is a computed column that sums percentages across the array
-- so the application can validate that splits total 100 without a round-trip.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rezonate_revenue_splits (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID          REFERENCES rezonate_collab_sessions(id) ON DELETE CASCADE UNIQUE,
  split_config     JSONB         NOT NULL DEFAULT '[]',
  -- split_config shape: [{ user_id, display_name, percentage, stripe_account_id }]
  total_percentage DECIMAL(5,2)  GENERATED ALWAYS AS (
    (SELECT SUM((item->>'percentage')::DECIMAL)
     FROM jsonb_array_elements(split_config) AS item)
  ) STORED,
  locked           BOOLEAN       DEFAULT FALSE,
  locked_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   DEFAULT NOW()
);

COMMENT ON TABLE rezonate_revenue_splits IS
  'Rezonate – revenue split configuration for a collaboration session. '
  'split_config is a JSONB array of { user_id, display_name, percentage, '
  'stripe_account_id } objects. total_percentage is computed and must equal '
  '100 before locked can be set to TRUE. Once locked, the billing pipeline '
  'uses this row to distribute Stripe payouts.';

-- ============================================================================
-- UPDATED_AT TRIGGER
-- Automatically refreshes updated_at on every UPDATE.
-- ============================================================================
CREATE TRIGGER rezonate_revenue_splits_set_updated_at
  BEFORE UPDATE ON rezonate_revenue_splits
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE rezonate_revenue_splits ENABLE ROW LEVEL SECURITY;

-- Service role: unrestricted (billing pipeline and Edge Functions).
CREATE POLICY "service_role_full_access_rezonate_revenue_splits"
  ON rezonate_revenue_splits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Session participants may read the split config for sessions they are in.
CREATE POLICY "participants_read_rezonate_revenue_splits"
  ON rezonate_revenue_splits FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM rezonate_collab_contributions c
      WHERE c.session_id = session_id AND c.user_id = auth.uid()
    )
  );

-- Only the session creator may insert the split configuration, and only while
-- the session is not yet locked.
CREATE POLICY "creator_insert_rezonate_revenue_splits"
  ON rezonate_revenue_splits FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rezonate_collab_sessions s
      WHERE s.id = session_id AND s.created_by = auth.uid()
    )
    AND locked = FALSE
  );

-- Only the session creator may update the split configuration while unlocked.
CREATE POLICY "creator_update_rezonate_revenue_splits"
  ON rezonate_revenue_splits FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM rezonate_collab_sessions s
      WHERE s.id = session_id AND s.created_by = auth.uid()
    )
    AND locked = FALSE
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rezonate_collab_sessions s
      WHERE s.id = session_id AND s.created_by = auth.uid()
    )
  );
