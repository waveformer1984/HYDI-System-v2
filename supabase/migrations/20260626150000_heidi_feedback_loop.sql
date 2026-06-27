-- Phase 5: Feedback Loop System
-- Enables learning from human approvals and rejections

-- Table: heidi_feedback
-- Stores human feedback on HEIDI decisions
CREATE TABLE IF NOT EXISTS heidi_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES heidi_events(id) ON DELETE CASCADE,
  approval TEXT NOT NULL CHECK (approval IN ('approved', 'rejected', 'needs-changes')),
  outcome BOOLEAN NOT NULL,  -- Was the decision correct?
  notes TEXT,
  division TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by TEXT  -- User ID of person giving feedback
);

CREATE INDEX idx_heidi_feedback_event ON heidi_feedback(event_id);
CREATE INDEX idx_heidi_feedback_division ON heidi_feedback(division);
CREATE INDEX idx_heidi_feedback_outcome ON heidi_feedback(outcome);

-- Update hydi_facts to track feedback
ALTER TABLE hydi_facts ADD COLUMN IF NOT EXISTS updates_count INT DEFAULT 0;
ALTER TABLE hydi_facts ADD COLUMN IF NOT EXISTS last_feedback_at TIMESTAMP;

-- Enable RLS
ALTER TABLE heidi_feedback ENABLE ROW LEVEL SECURITY;

-- Policy: service_role can read/write
CREATE POLICY heidi_feedback_service_role ON heidi_feedback
  FOR ALL USING (true)
  WITH CHECK (true);

-- Function: Get feedback stats for a division
CREATE OR REPLACE FUNCTION get_feedback_stats(target_division TEXT)
RETURNS TABLE(
  total_feedback INT,
  approved_count INT,
  rejected_count INT,
  approval_rate NUMERIC,
  avg_outcome NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INT as total_feedback,
    COUNT(*) FILTER (WHERE approval = 'approved')::INT as approved_count,
    COUNT(*) FILTER (WHERE approval = 'rejected')::INT as rejected_count,
    (COUNT(*) FILTER (WHERE approval = 'approved')::NUMERIC / NULLIF(COUNT(*), 0))::NUMERIC as approval_rate,
    AVG(outcome::INT)::NUMERIC as avg_outcome
  FROM heidi_feedback
  WHERE division = target_division;
END;
$$ LANGUAGE plpgsql;

-- Function: Update fact confidence based on feedback
CREATE OR REPLACE FUNCTION update_fact_from_feedback(
  p_fact_id UUID,
  p_was_successful BOOLEAN
)
RETURNS TABLE(old_confidence NUMERIC, new_confidence NUMERIC) AS $$
DECLARE
  v_old_conf NUMERIC;
  v_new_conf NUMERIC;
BEGIN
  SELECT confidence INTO v_old_conf FROM hydi_facts WHERE id = p_fact_id;

  IF p_was_successful THEN
    v_new_conf := LEAST(0.97, v_old_conf + 0.02);
  ELSE
    v_new_conf := GREATEST(0.50, v_old_conf - 0.03);
  END IF;

  UPDATE hydi_facts
  SET
    confidence = v_new_conf,
    updates_count = updates_count + 1,
    last_feedback_at = NOW()
  WHERE id = p_fact_id;

  RETURN QUERY SELECT v_old_conf, v_new_conf;
END;
$$ LANGUAGE plpgsql;
