-- ADAPTIVE OPERATOR EVENTS — durable persistence for AdaptiveOperator
-- journal entries and task memory.
--
-- The AdaptiveOperator (lib/adaptive-operator/) tracks observations,
-- actions, replans, deviations, failures, and completions during
-- multi-step goal execution. Local-disk persistence (ActionJournal,
-- TaskMemoryStore) works for local-first deployment but is fragile
-- (fresh clones, disk crashes). This table provides Supabase-backed
-- durability so replanning history and task memory survive cold starts.
--
-- The table is an append-only event stream keyed by goal_id. Each event
-- has a type (observation, action, replan, deviation, failure, completion,
-- intervention, decision), a timestamp, and a JSONB payload. Secrets are
-- redacted before insertion by the application layer (structured-logger's
-- redaction patterns + ActionJournal's redactParameters).

CREATE TABLE IF NOT EXISTS public.adaptive_operator_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id       text NOT NULL,
  session_id    text,
  user_id       text,
  event_type    text NOT NULL CHECK (event_type IN (
    'observation', 'action', 'replan', 'deviation', 'failure',
    'completion', 'intervention', 'decision', 'goal_received',
    'budget_exhausted', 'escalation'
  )),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ao_events_goal_id
  ON public.adaptive_operator_events (goal_id);
CREATE INDEX IF NOT EXISTS idx_ao_events_session_id
  ON public.adaptive_operator_events (session_id);
CREATE INDEX IF NOT EXISTS idx_ao_events_type
  ON public.adaptive_operator_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ao_events_created_at
  ON public.adaptive_operator_events (created_at DESC);

ALTER TABLE public.adaptive_operator_events ENABLE ROW LEVEL SECURITY;

-- Service role has full access (server code uses service role key).
-- Direct authenticated-user access is denied by default (no policy =
-- deny under RLS). The application layer reads/writes via the service
-- role, not user JWTs.
DROP POLICY IF EXISTS "ao_events_service_all" ON public.adaptive_operator_events;
CREATE POLICY "ao_events_service_all" ON public.adaptive_operator_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
