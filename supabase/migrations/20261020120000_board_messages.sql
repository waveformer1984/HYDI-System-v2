-- Forge Board. A shared chat log for Jordan and the agents.
-- This is not agent_bus. agent_bus rows with status pending are tasks Heidi
-- executes. A board message must never be inserted there.

CREATE TABLE IF NOT EXISTS public.board_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL DEFAULT now(),
  sender text NOT NULL CHECK (char_length(sender) BETWEEN 1 AND 64),
  sender_type text NOT NULL CHECK (sender_type IN ('human', 'agent')),
  channel text NOT NULL DEFAULT 'general' CHECK (channel IN ('general', 'ops', 'alerts')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  reply_to uuid REFERENCES public.board_messages (id),
  mentions text[] NOT NULL DEFAULT '{}'
);

COMMENT ON TABLE public.board_messages IS
  'Forge Board chat. Data only — never a task, never an instruction to execute.';

CREATE INDEX IF NOT EXISTS board_messages_channel_ts_idx
  ON public.board_messages (channel, ts);

ALTER TABLE public.board_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS board_messages_service_role ON public.board_messages;
CREATE POLICY board_messages_service_role
  ON public.board_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.board_messages TO service_role;
