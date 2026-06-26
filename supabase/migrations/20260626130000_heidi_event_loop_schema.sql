-- Phase 2: Heidi persistent agent event loop schema

-- Agent bus for task queueing
CREATE TABLE IF NOT EXISTS agent_bus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, executing, completed, failed
  priority INT DEFAULT 0,
  division TEXT,
  payload JSONB NOT NULL,
  confidence FLOAT DEFAULT 0.5,
  within_bounds BOOLEAN DEFAULT true,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Heidi decision bounds and lease management
CREATE TABLE IF NOT EXISTS heidi_decision_bounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_approve_threshold FLOAT DEFAULT 0.85,
  max_auto_approve_amount BIGINT DEFAULT 10000,
  lease_holder TEXT,
  lease_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Heidi events: audit trail of all decisions
CREATE TABLE IF NOT EXISTS heidi_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL, -- decision, reflection, drift, etc
  division TEXT,
  payload JSONB,
  verdict TEXT, -- AUTO-APPROVE, REVIEW, BLOCK
  context_snapshot JSONB,
  memory_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Heidi reflections: learned insights from decision cycles
CREATE TABLE IF NOT EXISTS heidi_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reflection JSONB NOT NULL, -- patterns, uncertainties, improvements
  event_range JSONB, -- { from: UUID, to: UUID }
  cycle INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Initialize decision bounds (one row)
INSERT INTO heidi_decision_bounds (auto_approve_threshold, max_auto_approve_amount, lease_holder, lease_expires)
VALUES (0.85, 10000, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_bus_status ON agent_bus(status);
CREATE INDEX IF NOT EXISTS idx_agent_bus_priority ON agent_bus(priority DESC);
CREATE INDEX IF NOT EXISTS idx_heidi_events_verdict ON heidi_events(verdict);
CREATE INDEX IF NOT EXISTS idx_heidi_events_division ON heidi_events(division);
CREATE INDEX IF NOT EXISTS idx_heidi_reflections_cycle ON heidi_reflections(cycle DESC);

-- Row-level security
ALTER TABLE agent_bus ENABLE ROW LEVEL SECURITY;
ALTER TABLE heidi_decision_bounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE heidi_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE heidi_reflections ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY agent_bus_service_role ON agent_bus FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY heidi_decision_bounds_service_role ON heidi_decision_bounds FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY heidi_events_service_role ON heidi_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY heidi_reflections_service_role ON heidi_reflections FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow authenticated users to read (audit trail)
CREATE POLICY heidi_events_read ON heidi_events FOR SELECT TO authenticated USING (true);
CREATE POLICY heidi_reflections_read ON heidi_reflections FOR SELECT TO authenticated USING (true);
