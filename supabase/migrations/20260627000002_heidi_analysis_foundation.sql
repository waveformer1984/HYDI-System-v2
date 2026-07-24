-- Analysis Foundation Tables for HEIDI Self-Improvement
-- Phase 2: Self-Analysis Engine

-- heidi_analysis_results: Analysis run outputs
CREATE TABLE IF NOT EXISTS public.heidi_analysis_results (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  analysis_type TEXT NOT NULL, -- 'pattern_recognition', 'root_cause', 'capability_assessment', 'anomaly_detection', 'trend_analysis'
  analysis_name TEXT,
  metrics_period_start TIMESTAMP WITH TIME ZONE,
  metrics_period_end TIMESTAMP WITH TIME ZONE,
  findings JSONB NOT NULL, -- {patterns: [], root_causes: [], capabilities: {strengths: [], weaknesses: []}, anomalies: [], trends: []}
  confidence_score NUMERIC, -- 0-100
  actionability_score NUMERIC, -- how actionable are the findings? 0-100
  priority TEXT DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
  summary TEXT,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_analysis_results_created ON public.heidi_analysis_results(created_at DESC);
CREATE INDEX idx_heidi_analysis_results_type ON public.heidi_analysis_results(analysis_type);
CREATE INDEX idx_heidi_analysis_results_priority ON public.heidi_analysis_results(priority);

-- heidi_patterns: Identified behavioral patterns
CREATE TABLE IF NOT EXISTS public.heidi_patterns (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  pattern_name TEXT NOT NULL, -- 'high_loop_latency_on_revenue_tasks', 'memory_leak_after_reflection'
  pattern_type TEXT NOT NULL, -- 'success_pattern', 'failure_pattern', 'performance_pattern'
  description TEXT,
  conditions JSONB, -- When this pattern occurs: {task_type: 'revenue', time_of_day: 'evening'}
  occurrence_count BIGINT DEFAULT 0,
  success_rate NUMERIC, -- If applicable
  last_detected_at TIMESTAMP WITH TIME ZONE,
  confidence NUMERIC, -- How confident are we in this pattern? 0-100
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_patterns_created ON public.heidi_patterns(created_at DESC);
CREATE INDEX idx_heidi_patterns_type ON public.heidi_patterns(pattern_type);

-- heidi_root_causes: Identified failure causes
CREATE TABLE IF NOT EXISTS public.heidi_root_causes (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  cause_name TEXT NOT NULL, -- 'orchestrator_timeout_on_high_load', 'memory_exhaustion_in_reflection'
  affected_module TEXT,
  affected_task_types TEXT ARRAY,
  description TEXT,
  occurrence_count BIGINT DEFAULT 0,
  avg_impact_on_success_rate NUMERIC, -- percentage point reduction
  suggested_mitigation TEXT ARRAY,
  priority TEXT DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
  confidence NUMERIC, -- 0-100
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_root_causes_created ON public.heidi_root_causes(created_at DESC);
CREATE INDEX idx_heidi_root_causes_module ON public.heidi_root_causes(affected_module);

-- heidi_capabilities: Capability assessment results
CREATE TABLE IF NOT EXISTS public.heidi_capabilities (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  capability_name TEXT NOT NULL, -- 'revenue_task_execution', 'memory_retrieval', 'orchestrator_routing'
  category TEXT NOT NULL, -- 'strength', 'weakness', 'neutral'
  assessment_period_start TIMESTAMP WITH TIME ZONE,
  assessment_period_end TIMESTAMP WITH TIME ZONE,
  metrics JSONB, -- {success_rate: 0.95, avg_duration_ms: 125, throughput: 10}
  score NUMERIC, -- 0-100
  confidence NUMERIC, -- Assessment confidence
  supporting_evidence TEXT ARRAY,
  improvement_suggestions TEXT ARRAY,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_capabilities_created ON public.heidi_capabilities(created_at DESC);
CREATE INDEX idx_heidi_capabilities_category ON public.heidi_capabilities(category);

-- heidi_anomalies: Detected anomalies and outliers
CREATE TABLE IF NOT EXISTS public.heidi_anomalies (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metric_name TEXT NOT NULL,
  anomaly_type TEXT NOT NULL, -- 'statistical_outlier', 'behavioral_change', 'performance_regression', 'capability_shift'
  baseline_value NUMERIC,
  anomalous_value NUMERIC,
  deviation_sigma NUMERIC, -- How many standard deviations from mean?
  severity TEXT DEFAULT 'info', -- 'critical', 'warning', 'info'
  first_detected_at TIMESTAMP WITH TIME ZONE,
  last_detected_at TIMESTAMP WITH TIME ZONE,
  occurrence_count BIGINT DEFAULT 0,
  description TEXT,
  potential_causes TEXT ARRAY,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_anomalies_created ON public.heidi_anomalies(created_at DESC);
CREATE INDEX idx_heidi_anomalies_type ON public.heidi_anomalies(anomaly_type);
CREATE INDEX idx_heidi_anomalies_severity ON public.heidi_anomalies(severity);

-- heidi_trends: Long-term trend analysis
CREATE TABLE IF NOT EXISTS public.heidi_trends (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metric_name TEXT NOT NULL,
  trend_direction TEXT NOT NULL, -- 'improving', 'degrading', 'stable'
  time_period TEXT, -- '7d', '30d', '90d'
  period_start TIMESTAMP WITH TIME ZONE,
  period_end TIMESTAMP WITH TIME ZONE,
  start_value NUMERIC,
  end_value NUMERIC,
  change_percent NUMERIC,
  velocity NUMERIC, -- Rate of change per day
  forecast_next_period_value NUMERIC, -- Simple forecast
  confidence NUMERIC, -- Trend confidence 0-100
  implication TEXT, -- What does this trend mean?
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_trends_created ON public.heidi_trends(created_at DESC);
CREATE INDEX idx_heidi_trends_metric ON public.heidi_trends(metric_name);
CREATE INDEX idx_heidi_trends_direction ON public.heidi_trends(trend_direction);

-- Enable RLS
ALTER TABLE public.heidi_analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_root_causes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_trends ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow service role full access
CREATE POLICY "Service role can access analysis results" ON public.heidi_analysis_results
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can access patterns" ON public.heidi_patterns
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can access root causes" ON public.heidi_root_causes
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can access capabilities" ON public.heidi_capabilities
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can access anomalies" ON public.heidi_anomalies
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can access trends" ON public.heidi_trends
  USING (auth.role() = 'service_role');
