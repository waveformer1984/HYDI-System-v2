-- HUMAN INTERVENTION REQUESTS — durable persistence for delegated operator
-- intervention queue.
--
-- The InterventionQueue (lib/delegated-operator/InterventionQueue.ts) tracks
-- points where HYDI cannot continue without human action. In-memory state
-- is fragile — this table provides Supabase-backed durability so
-- interventions survive cold starts, process restarts, and PM2 reloads.
--
-- Secrets are redacted BEFORE insertion by the application layer.
-- No raw credential values, API keys, tokens, or authentication cookies
-- are ever written. Only references and metadata are persisted.

CREATE TABLE IF NOT EXISTS public.human_intervention_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      text NOT NULL UNIQUE,        -- application-generated ID
  goal_id         text NOT NULL,
  session_id      text,
  user_id         text,
  identity_id     text,
  objective       text,                         -- current objective when triggered
  blocker         text NOT NULL,                -- what blocker was hit
  required_action text NOT NULL,                -- what the human needs to do
  why_required    text NOT NULL,                -- why human action is required
  expected_state  text,                         -- expected state after human acts
  resume_condition text,                        -- what HYDI will check before continuing
  intervention_type text NOT NULL,              -- MFA, CAPTCHA, CREDENTIALS_NEEDED, etc.
  audit_id        text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'resolved', 'expired', 'cancelled')),
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  completed_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interventions_goal_id
  ON public.human_intervention_requests (goal_id);
CREATE INDEX IF NOT EXISTS idx_interventions_status
  ON public.human_intervention_requests (status);
CREATE INDEX IF NOT EXISTS idx_interventions_session_id
  ON public.human_intervention_requests (session_id);
CREATE INDEX IF NOT EXISTS idx_interventions_expires_at
  ON public.human_intervention_requests (expires_at);

ALTER TABLE public.human_intervention_requests ENABLE ROW LEVEL SECURITY;

-- Service role has full access (server code uses service role key).
-- Direct authenticated-user access is denied by default (no policy =
-- deny under RLS). The application layer reads/writes via the service
-- role, not user JWTs.
DROP POLICY IF EXISTS "interventions_service_all" ON public.human_intervention_requests;
CREATE POLICY "interventions_service_all" ON public.human_intervention_requests
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_intervention_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_intervention_updated_at ON public.human_intervention_requests;
CREATE TRIGGER trg_intervention_updated_at
  BEFORE UPDATE ON public.human_intervention_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_intervention_updated_at();
