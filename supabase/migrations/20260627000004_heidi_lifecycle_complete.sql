-- HEIDI Self-Improvement Complete Lifecycle
-- Phases 4-8: Version Control, Validation, Deployment, Approval, Orchestration

-- Phase 4: Version Control
CREATE TABLE IF NOT EXISTS public.heidi_versions (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  version_id TEXT UNIQUE,
  improvement_id TEXT REFERENCES public.heidi_recommendations(recommendation_id),
  code_hash TEXT,
  config_hash TEXT,
  metadata JSONB,
  notes TEXT,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_versions_created ON public.heidi_versions(created_at DESC);
CREATE INDEX idx_heidi_versions_improvement ON public.heidi_versions(improvement_id);

-- Phase 5: Validation Framework
CREATE TABLE IF NOT EXISTS public.heidi_experiments (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  experiment_id TEXT UNIQUE,
  improvement_id TEXT REFERENCES public.heidi_recommendations(recommendation_id),
  test_type TEXT, -- 'ab_test', 'synthetic_benchmark', 'shadow_test'
  duration_seconds BIGINT,
  control_metrics JSONB,
  treatment_metrics JSONB,
  results JSONB,
  verdict BOOLEAN, -- True if improvement passed validation
  confidence_score NUMERIC,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_experiments_created ON public.heidi_experiments(created_at DESC);
CREATE INDEX idx_heidi_experiments_improvement ON public.heidi_experiments(improvement_id);
CREATE INDEX idx_heidi_experiments_verdict ON public.heidi_experiments(verdict);

-- Phase 6: Deployments & Rollback
CREATE TABLE IF NOT EXISTS public.heidi_deployments (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deployment_id TEXT UNIQUE,
  improvement_id TEXT REFERENCES public.heidi_recommendations(recommendation_id),
  deployment_type TEXT, -- 'canary', 'full', 'shadow'
  status TEXT DEFAULT 'in_progress', -- 'in_progress', 'completed', 'rolled_back', 'failed'
  canary_percent NUMERIC,
  pre_deployment_version TEXT REFERENCES public.heidi_versions(version_id),
  metrics_during_deployment JSONB,
  deployment_duration_seconds BIGINT,
  success BOOLEAN,
  failure_reason TEXT,
  rolled_back_at TIMESTAMP WITH TIME ZONE,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_deployments_created ON public.heidi_deployments(created_at DESC);
CREATE INDEX idx_heidi_deployments_status ON public.heidi_deployments(status);
CREATE INDEX idx_heidi_deployments_improvement ON public.heidi_deployments(improvement_id);

-- Phase 7: Approvals & Authorization
CREATE TABLE IF NOT EXISTS public.heidi_approvals (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approval_id TEXT UNIQUE,
  recommendation_id BIGINT REFERENCES public.heidi_recommendations(id),
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  submitted_at TIMESTAMP WITH TIME ZONE,
  submitted_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  approved_by UUID REFERENCES auth.users(id),
  approval_notes TEXT,
  rationale TEXT,
  ai_confidence_score NUMERIC,
  permission_envelope JSONB, -- {auto_approve_below_score: 60, requires_human_review: true}
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_approvals_created ON public.heidi_approvals(created_at DESC);
CREATE INDEX idx_heidi_approvals_status ON public.heidi_approvals(status);
CREATE INDEX idx_heidi_approvals_recommendation ON public.heidi_approvals(recommendation_id);

-- Phase 8: Improvement Cycles (Orchestration)
CREATE TABLE IF NOT EXISTS public.heidi_improvement_cycles (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  cycle_id TEXT UNIQUE,
  analysis_period_hours BIGINT,
  analysis_health_score NUMERIC,
  recommendations_count BIGINT,
  validated_count BIGINT,
  deployed_count BIGINT,
  failed_count BIGINT,
  overall_status TEXT, -- 'completed', 'in_progress', 'failed'
  cycle_duration_seconds BIGINT,
  results JSONB, -- Full cycle results
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_improvement_cycles_created ON public.heidi_improvement_cycles(created_at DESC);
CREATE INDEX idx_heidi_improvement_cycles_status ON public.heidi_improvement_cycles(overall_status);

-- Audit Log (all actions)
CREATE TABLE IF NOT EXISTS public.heidi_audit_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  action TEXT NOT NULL, -- 'recommendation_generated', 'test_passed', 'deployment_started', 'rollback_triggered', etc.
  resource_type TEXT, -- 'recommendation', 'experiment', 'deployment', 'approval', 'cycle'
  resource_id TEXT,
  actor_type TEXT, -- 'system', 'user', 'ai'
  actor_id TEXT,
  details JSONB,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_heidi_audit_log_created ON public.heidi_audit_log(created_at DESC);
CREATE INDEX idx_heidi_audit_log_action ON public.heidi_audit_log(action);
CREATE INDEX idx_heidi_audit_log_resource ON public.heidi_audit_log(resource_type, resource_id);

-- Enable RLS
ALTER TABLE public.heidi_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_improvement_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heidi_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies (service role access)
CREATE POLICY "Service role versions" ON public.heidi_versions USING (auth.role() = 'service_role');
CREATE POLICY "Service role experiments" ON public.heidi_experiments USING (auth.role() = 'service_role');
CREATE POLICY "Service role deployments" ON public.heidi_deployments USING (auth.role() = 'service_role');
CREATE POLICY "Service role approvals" ON public.heidi_approvals USING (auth.role() = 'service_role');
CREATE POLICY "Service role cycles" ON public.heidi_improvement_cycles USING (auth.role() = 'service_role');
CREATE POLICY "Service role audit" ON public.heidi_audit_log USING (auth.role() = 'service_role');
