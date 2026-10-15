-- Phase 5: bind execution-fabric tasks to a server-derived tenant and creator.
-- Existing rows stay tenant_id NULL (unknown ownership). Do not backfill a default tenant.
-- Application code refuses to assign those rows to an arbitrary tenant.
-- service_role RLS remains USING (true); isolation is enforced in the task store
-- because the API connects as service_role (which bypasses restrictive policies).

ALTER TABLE public.execution_fabric_tasks
  ADD COLUMN IF NOT EXISTS tenant_id text,
  ADD COLUMN IF NOT EXISTS created_by text;

COMMENT ON COLUMN public.execution_fabric_tasks.tenant_id IS
  'Server-derived tenant. NULL means unknown ownership — not claimable by a tenant-scoped caller.';
COMMENT ON COLUMN public.execution_fabric_tasks.created_by IS
  'Authenticated principal subject at creation. Not a client-supplied operator id.';

CREATE INDEX IF NOT EXISTS execution_fabric_tasks_tenant_updated_idx
  ON public.execution_fabric_tasks (tenant_id, updated_at DESC);

-- Prevent a later update from rewriting ownership once set.
CREATE OR REPLACE FUNCTION public.execution_fabric_lock_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'execution_fabric_ownership_immutable';
  END IF;
  IF OLD.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'execution_fabric_ownership_immutable';
  END IF;
  IF OLD.tenant_id IS NULL AND NEW.tenant_id IS NOT NULL THEN
    RAISE EXCEPTION 'execution_fabric_unowned_not_claimable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS execution_fabric_lock_ownership ON public.execution_fabric_tasks;
CREATE TRIGGER execution_fabric_lock_ownership
  BEFORE UPDATE ON public.execution_fabric_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.execution_fabric_lock_ownership();
