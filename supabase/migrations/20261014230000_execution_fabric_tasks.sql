-- EXECUTION FABRIC — durable task lifecycle (mobile ops control plane).
-- Service-role only (same convention as heidi_operator_lease).
-- Idempotency: unique (idempotency_scope, idempotency_key) when key present.

CREATE TABLE IF NOT EXISTS public.execution_fabric_tasks (
  id                text        PRIMARY KEY,
  objective         text,
  capability_id     text        NOT NULL,
  state             text        NOT NULL,
  actor             text,
  role              text        NOT NULL,
  environment       text        NOT NULL DEFAULT 'heidi-web',
  plan              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "authorization"   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  input             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  checkpoint        jsonb,
  job_id            text,
  idempotency_key   text,
  idempotency_scope text,
  attempt_count     integer     NOT NULL DEFAULT 0,
  lease_holder      text,
  lease_expires_at  timestamptz,
  outcome           jsonb,
  verification      jsonb,
  learnings         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  errors            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  recovery          jsonb,
  failure_class     text,
  steps             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  version           integer     NOT NULL DEFAULT 0,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS execution_fabric_tasks_idempotency_idx
  ON public.execution_fabric_tasks (idempotency_scope, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS execution_fabric_tasks_state_updated_idx
  ON public.execution_fabric_tasks (state, updated_at DESC);

CREATE INDEX IF NOT EXISTS execution_fabric_tasks_lease_expires_idx
  ON public.execution_fabric_tasks (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.execution_fabric_observations (
  id          bigserial   PRIMARY KEY,
  task_id     text        REFERENCES public.execution_fabric_tasks(id) ON DELETE CASCADE,
  kind        text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS execution_fabric_observations_task_idx
  ON public.execution_fabric_observations (task_id, created_at DESC);

COMMENT ON TABLE public.execution_fabric_tasks IS
  'Durable mobile execution-fabric tasks. State transitions enforced in application layer; version column for optimistic concurrency.';

ALTER TABLE public.execution_fabric_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_fabric_tasks_service_role ON public.execution_fabric_tasks;
DO $$ BEGIN
  CREATE POLICY execution_fabric_tasks_service_role ON public.execution_fabric_tasks
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.execution_fabric_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_fabric_observations_service_role ON public.execution_fabric_observations;
DO $$ BEGIN
  CREATE POLICY execution_fabric_observations_service_role ON public.execution_fabric_observations
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
