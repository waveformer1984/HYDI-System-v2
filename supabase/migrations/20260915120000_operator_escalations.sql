-- Operator Escalations Table
--
-- Durable storage for operator escalation notifications. The
-- EscalationNotifier writes here as a fallback when Slack is not
-- configured, and as a durable record even when Slack is available.
--
-- This closes the gap flagged several rounds back: "no automated
-- Slack/email notification, only log files/DB query."

CREATE TABLE IF NOT EXISTS operator_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_taken TEXT,
  action_required TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

-- RLS: service role can read/write, no public access
ALTER TABLE operator_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY operator_escalations_service_role_all
  ON operator_escalations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Index for querying unresolved escalations
CREATE INDEX IF NOT EXISTS idx_operator_escalations_unresolved
  ON operator_escalations (resolved, severity, created_at DESC)
  WHERE resolved = false;

-- Index for querying by category
CREATE INDEX IF NOT EXISTS idx_operator_escalations_category
  ON operator_escalations (category, created_at DESC);
