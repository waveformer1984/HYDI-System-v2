-- Telemetry Foundation Tables for HEIDI Self-Improvement System
-- Phase 1: Metrics Instrumentation

-- heidi_telemetry: Raw metric events (immutable append-only log)
CREATE TABLE IF NOT EXISTS public.heidi_telemetry (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metric_type TEXT NOT NULL, -- 'loop_cycle', 'decision', 'action', 'memory', 'error', 'performance'
  metric_name TEXT NOT NULL, -- e.g., 'heidi_core_loop_duration_ms', 'orchestrator_task_routing_success'
  value NUMERIC,
  tags JSONB DEFAULT '{}'::JSONB, -- {agent: 'Hyve', module: 'HeidiOrchestrator', phase: 'decide'}
  metadata JSONB DEFAULT '{}'::JSONB, -- extra context-specific data
  session_id TEXT, -- for grouping by session
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_telemetry_created ON public.heidi_telemetry(created_at DESC);
CREATE INDEX idx_heidi_telemetry_metric_type ON public.heidi_telemetry(metric_type);
CREATE INDEX idx_heidi_telemetry_metric_name ON public.heidi_telemetry(metric_name);
CREATE INDEX idx_heidi_telemetry_session ON public.heidi_telemetry(session_id);

-- heidi_metrics_snapshots: Periodic aggregated metrics (for trending)
CREATE TABLE IF NOT EXISTS public.heidi_metrics_snapshots (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  snapshot_type TEXT NOT NULL, -- 'hourly', 'daily', 'weekly'
  metrics JSONB NOT NULL, -- aggregated metrics blob
  summary JSONB, -- high-level summary (e.g., {success_rate: 0.95, avg_loop_time: 125})
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_metrics_snapshots_created ON public.heidi_metrics_snapshots(created_at DESC);
CREATE INDEX idx_heidi_metrics_snapshots_type ON public.heidi_metrics_snapshots(snapshot_type);

-- heidi_performance_baseline: Baseline metrics for comparison
CREATE TABLE IF NOT EXISTS public.heidi_performance_baseline (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  baseline_name TEXT NOT NULL UNIQUE, -- 'v1.0_initial', 'v1.1_after_optimization'
  baseline_version TEXT, -- git commit hash or version tag
  metrics JSONB NOT NULL, -- full baseline data
  description TEXT,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_performance_baseline_created ON public.heidi_performance_baseline(created_at DESC);

-- heidi_module_performance: Per-module metrics tracking
CREATE TABLE IF NOT EXISTS public.heidi_module_performance (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  module_name TEXT NOT NULL, -- 'HeidiCoreLoop', 'HeidiOrchestrator', 'HeidiMemorySystem', etc.
  metric_period_start TIMESTAMP WITH TIME ZONE,
  metric_period_end TIMESTAMP WITH TIME ZONE,
  invocations BIGINT DEFAULT 0,
  successes BIGINT DEFAULT 0,
  failures BIGINT DEFAULT 0,
  avg_duration_ms NUMERIC,
  min_duration_ms NUMERIC,
  max_duration_ms NUMERIC,
  error_rate NUMERIC, -- failures / invocations
  quality_score NUMERIC, -- 0-100
  metadata JSONB DEFAULT '{}'::JSONB,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_module_performance_created ON public.heidi_module_performance(created_at DESC);
CREATE INDEX idx_heidi_module_performance_module ON public.heidi_module_performance(module_name);

-- heidi_drift_detection: Track system changes and anomalies
CREATE TABLE IF NOT EXISTS public.heidi_drift_detection (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  drift_type TEXT NOT NULL, -- 'metric_regression', 'performance_anomaly', 'capability_change', 'cost_increase'
  metric_name TEXT,
  baseline_value NUMERIC,
  current_value NUMERIC,
  deviation_percent NUMERIC, -- percent change from baseline
  severity TEXT DEFAULT 'info', -- 'info', 'warning', 'critical'
  description TEXT,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_drift_detection_created ON public.heidi_drift_detection(created_at DESC);
CREATE INDEX idx_heidi_drift_detection_type ON public.heidi_drift_detection(drift_type);
CREATE INDEX idx_heidi_drift_detection_severity ON public.heidi_drift_detection(severity);

-- Enable RLS
ALTER TABLE public.heidi_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_metrics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_performance_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_module_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_drift_detection ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow service role full access (for system automation)
CREATE POLICY "Service role can access telemetry" ON public.heidi_telemetry
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can access metrics snapshots" ON public.heidi_metrics_snapshots
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can access baselines" ON public.heidi_performance_baseline
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can access module performance" ON public.heidi_module_performance
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can access drift detection" ON public.heidi_drift_detection
  USING (auth.role() = 'service_role');

-- Retention policy comment (manual cleanup for now, can be automated with pg_cron later)
COMMENT ON TABLE public.heidi_telemetry IS 'Raw telemetry events - consider retention policy: keep 30 days by default, older rows can be archived';
