-- GOAL CHECKPOINTS — durable persistence for delegated operator
-- checkpoint/restart recovery.
--
-- The GoalCheckpointManager (lib/delegated-operator/GoalCheckpoint.ts) saves
-- goal state at safe points during execution. In-memory state is fragile —
-- this table provides Supabase-backed durability so checkpoints survive
-- cold starts, process restarts, and PM2 reloads.
--
-- Secrets are redacted BEFORE insertion by the application layer.
-- No raw credential values, API keys, tokens, or authentication cookies
-- are ever written. Only references and metadata are persisted.

CREATE TABLE IF NOT EXISTS public.goal_checkpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id   text NOT NULL UNIQUE,       -- application-generated ID
  goal_id         text NOT NULL,
  session_id      text,
  identity_id     text,
  goal_statement  text,
  plan_version    integer NOT NULL DEFAULT 1,
  completed_objectives  jsonb NOT NULL DEFAULT '[]'::jsonb,
  failed_objectives      jsonb NOT NULL DEFAULT '[]'::jsonb,
  in_progress_objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_objectives     jsonb NOT NULL DEFAULT '[]'::jsonb,
  executed_actions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_state    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'RUNNING'
                    CHECK (status IN ('RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN', 'WAITING_FOR_PROVIDER', 'RECOVERING', 'COMPLETED', 'PARTIAL', 'FAILED', 'EXPIRED')),
  resume_condition  text,
  executed_side_effects jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary           text,
  -- Integrity / expiration
  checksum          text,                      -- simple hash of key fields for tamper detection
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_goal_id
  ON public.goal_checkpoints (goal_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_status
  ON public.goal_checkpoints (status);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session_id
  ON public.goal_checkpoints (session_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_created_at
  ON public.goal_checkpoints (created_at DESC);

ALTER TABLE public.goal_checkpoints ENABLE ROW LEVEL SECURITY;

-- Service role has full access (server code uses service role key).
DROP POLICY IF EXISTS "checkpoints_service_all" ON public.goal_checkpoints;
CREATE POLICY "checkpoints_service_all" ON public.goal_checkpoints
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_checkpoint_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_checkpoint_updated_at ON public.goal_checkpoints;
CREATE TRIGGER trg_checkpoint_updated_at
  BEFORE UPDATE ON public.goal_checkpoints
  FOR EACH ROW
  EXECUTE FUNCTION public.update_checkpoint_updated_at();
