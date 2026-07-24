-- Recommendations Foundation for HEIDI Self-Improvement
-- Phase 3: Recommendation Generator

-- heidi_recommendations: Improvement recommendations
CREATE TABLE IF NOT EXISTS public.heidi_recommendations (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  recommendation_id TEXT UNIQUE, -- 'rec_20260627_001'
  analysis_id BIGINT REFERENCES public.heidi_analysis_results(id),
  recommendation_type TEXT NOT NULL, -- 'parameter_tuning', 'algorithm_change', 'capability_expansion', 'error_handling', 'performance_optimization'
  title TEXT NOT NULL, -- "Increase orchestrator timeout threshold"
  description TEXT,
  current_state JSONB, -- Current parameter/setting value
  proposed_state JSONB, -- Proposed new value
  target_module TEXT,
  implementation_complexity TEXT DEFAULT 'medium', -- 'low', 'medium', 'high'
  estimated_effort_hours NUMERIC,
  expected_impact JSONB, -- {metric: 'error_rate', baseline: 8.5, projected: 4.2}
  roi_score NUMERIC, -- 0-100 (impact / effort)
  confidence_score NUMERIC, -- 0-100
  priority TEXT DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'deployed', 'rolled_back'
  rationale TEXT ARRAY, -- Why this recommendation?
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_recommendations_created ON public.heidi_recommendations(created_at DESC);
CREATE INDEX idx_heidi_recommendations_type ON public.heidi_recommendations(recommendation_type);
CREATE INDEX idx_heidi_recommendations_status ON public.heidi_recommendations(status);
CREATE INDEX idx_heidi_recommendations_priority ON public.heidi_recommendations(priority);

-- heidi_recommendation_scoring: Detailed scoring for each recommendation
CREATE TABLE IF NOT EXISTS public.heidi_recommendation_scoring (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  recommendation_id BIGINT REFERENCES public.heidi_recommendations(id),
  impact_score NUMERIC, -- 0-100: how much will this improve things?
  effort_score NUMERIC, -- 0-100: how much work is it? (lower is better)
  risk_score NUMERIC, -- 0-100: how risky is it? (lower is better)
  urgency_score NUMERIC, -- 0-100: how urgent?
  feasibility_score NUMERIC, -- 0-100: can we actually do this?
  roi_score NUMERIC, -- (impact_score - risk_score) / effort_score
  overall_score NUMERIC, -- Weighted combination
  breakdown JSONB, -- {impact: 75, effort: 20, risk: 10, urgency: 60, feasibility: 90}
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_recommendation_scoring_created ON public.heidi_recommendation_scoring(created_at DESC);
CREATE INDEX idx_heidi_recommendation_scoring_rec_id ON public.heidi_recommendation_scoring(recommendation_id);

-- Enable RLS
ALTER TABLE public.heidi_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_recommendation_scoring ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Service role can access recommendations" ON public.heidi_recommendations
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can access recommendation scoring" ON public.heidi_recommendation_scoring
  USING (auth.role() = 'service_role');
