-- HYDI Distributed Task Management
-- Central task queue for coordinating work across workers

CREATE TABLE IF NOT EXISTS public.hydi_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_type text NOT NULL,
    operation text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    priority text DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    status text DEFAULT 'queued' CHECK (status IN ('queued', 'assigned', 'running', 'completed', 'failed', 'cancelled')),
    assigned_worker text,
    result jsonb,
    error text,
    created_at timestamptz DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    retry_count int DEFAULT 0
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_hydi_tasks_status ON public.hydi_tasks(status);
CREATE INDEX IF NOT EXISTS idx_hydi_tasks_worker_type ON public.hydi_tasks(worker_type);
CREATE INDEX IF NOT EXISTS idx_hydi_tasks_priority ON public.hydi_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_hydi_tasks_assigned_worker ON public.hydi_tasks(assigned_worker);
CREATE INDEX IF NOT EXISTS idx_hydi_tasks_created_at ON public.hydi_tasks(created_at DESC);

-- Task result cache (for quick retrieval)
CREATE TABLE IF NOT EXISTS public.hydi_task_results (
    task_id uuid PRIMARY KEY REFERENCES public.hydi_tasks(id) ON DELETE CASCADE,
    result jsonb,
    cached_at timestamptz DEFAULT now()
);

-- Worker status/heartbeat (for monitoring)
CREATE TABLE IF NOT EXISTS public.hydi_worker_registry (
    worker_id text PRIMARY KEY,
    worker_type text,
    operations text[] DEFAULT '{}',
    capabilities jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'active' CHECK (status IN ('active', 'idle', 'busy', 'offline')),
    last_heartbeat timestamptz DEFAULT now(),
    tasks_completed int DEFAULT 0,
    tasks_failed int DEFAULT 0,
    registered_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hydi_worker_registry_status ON public.hydi_worker_registry(status);
CREATE INDEX IF NOT EXISTS idx_hydi_worker_registry_heartbeat ON public.hydi_worker_registry(last_heartbeat DESC);

-- Enable RLS
ALTER TABLE public.hydi_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hydi_task_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hydi_worker_registry ENABLE ROW LEVEL SECURITY;

-- Service role policies
DROP POLICY IF EXISTS "service_role_all" ON public.hydi_tasks;
CREATE POLICY "service_role_all" ON public.hydi_tasks
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.hydi_task_results;
CREATE POLICY "service_role_all" ON public.hydi_task_results
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON public.hydi_worker_registry;
CREATE POLICY "service_role_all" ON public.hydi_worker_registry
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- RPC: Get task queue depth by worker type
CREATE OR REPLACE FUNCTION public.hydi_get_queue_depth(p_worker_type text)
RETURNS TABLE(worker_type text, queue_depth bigint, running_count bigint) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p_worker_type::text,
        COUNT(*) FILTER (WHERE status = 'queued')::bigint as queue_depth,
        COUNT(*) FILTER (WHERE status = 'running')::bigint as running_count
    FROM public.hydi_tasks
    WHERE worker_type = p_worker_type;
END;
$$ LANGUAGE plpgsql;

-- RPC: Assign next task to worker
CREATE OR REPLACE FUNCTION public.hydi_assign_task(p_worker_id text, p_worker_type text)
RETURNS TABLE(id uuid, operation text, payload jsonb) AS $$
BEGIN
    RETURN QUERY
    UPDATE public.hydi_tasks
    SET status = 'assigned', assigned_worker = p_worker_id, started_at = now()
    WHERE id = (
        SELECT id FROM public.hydi_tasks
        WHERE worker_type = p_worker_type AND status = 'queued'
        ORDER BY priority DESC NULLS LAST, created_at ASC
        LIMIT 1
        FOR UPDATE
    )
    RETURNING public.hydi_tasks.id, public.hydi_tasks.operation, public.hydi_tasks.payload;
END;
$$ LANGUAGE plpgsql;
