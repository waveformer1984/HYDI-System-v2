-- Phase 4: correlate fabric tasks with operator workflows / mobile sessions.

ALTER TABLE public.execution_fabric_tasks
  ADD COLUMN IF NOT EXISTS correlation_id text;

UPDATE public.execution_fabric_tasks
  SET correlation_id = id
  WHERE correlation_id IS NULL;

COMMENT ON COLUMN public.execution_fabric_tasks.correlation_id IS
  'Stable correlation id for resumable mobile/operator workflows; defaults to task id.';
