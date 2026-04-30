-- ========================================
-- SYSTEM HEALTH RUNS TABLE
-- For persisting health check results
-- Run this in Supabase SQL Editor
-- ========================================

-- Create the table for health check runs
CREATE TABLE IF NOT EXISTS public.system_health_runs (
    id SERIAL PRIMARY KEY,
    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('OK', 'WARNING', 'CRITICAL')),
    environment TEXT DEFAULT 'production',
    
    -- Component statuses
    queue_status TEXT,
    event_flow_status TEXT,
    revenue_status TEXT,
    automation_status TEXT,
    entitlements_status TEXT,
    
    -- Issue counts
    issues_count INTEGER DEFAULT 0,
    warnings_count INTEGER DEFAULT 0,
    
    -- Full details as JSONB
    details JSONB,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_health_runs_run_at ON public.system_health_runs(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_runs_status ON public.system_health_runs(status);
CREATE INDEX IF NOT EXISTS idx_health_runs_environment ON public.system_health_runs(environment);

-- Enable RLS
ALTER TABLE public.system_health_runs ENABLE ROW LEVEL SECURITY;

-- Policy for service role access
CREATE POLICY "Service role can manage health runs"
    ON public.system_health_runs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- View for recent health trends
CREATE OR REPLACE VIEW public.health_trends_24h AS
SELECT 
    date_trunc('hour', run_at) AS hour,
    status,
    COUNT(*) AS run_count,
    AVG(issues_count) AS avg_issues,
    AVG(warnings_count) AS avg_warnings
FROM public.system_health_runs
WHERE run_at >= NOW() - INTERVAL '24 hours'
GROUP BY date_trunc('hour', run_at), status
ORDER BY hour DESC;

-- Sample queries:

-- Latest health status
-- SELECT * FROM public.system_health_runs ORDER BY run_at DESC LIMIT 1;

-- Health trend over last 24 hours
-- SELECT * FROM public.health_trends_24h;

-- Critical events count
-- SELECT COUNT(*) FROM public.system_health_runs 
-- WHERE status = 'CRITICAL' AND run_at >= NOW() - INTERVAL '24 hours';

-- Success! Table created.
SELECT 'system_health_runs table created successfully' AS result;
