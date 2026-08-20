-- HEIDI Communication Layer Schema Extension
--
-- Extends the existing chat_conversations, chat_messages, and operator_actions
-- tables to support the unified CommunicationLayer. Does NOT recreate tables
-- that already exist — only adds columns, constraints, indexes, and the
-- communication_events audit table.
--
-- Principles:
--   - identity ≠ permission ≠ policy ≠ execution ≠ causality ≠ observation
--   - all communication is auditable
--   - all outbound is idempotent
--   - tenant isolation is preserved
--   - RLS remains enabled

-- ─── chat_conversations extensions ────────────────────────────────────────

-- The unified layer may create conversations without a known owner (e.g.
-- inbound from a new prospect). Make owner_user_id nullable.
ALTER TABLE chat_conversations ALTER COLUMN owner_user_id DROP NOT NULL;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'web_chat',
  ADD COLUMN IF NOT EXISTS prospect_id text,
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS opportunity_id text,
  ADD COLUMN IF NOT EXISTS support_case_id text,
  ADD COLUMN IF NOT EXISTS classification text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

ALTER TABLE chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_status_check;

ALTER TABLE chat_conversations
  ADD CONSTRAINT chat_conversations_status_check
  CHECK (status IN ('active', 'closed', 'escalated', 'archived'));

ALTER TABLE chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_channel_check;

ALTER TABLE chat_conversations
  ADD CONSTRAINT chat_conversations_channel_check
  CHECK (channel IN (
    'heidi_core', 'web_chat', 'mobile_chat', 'websocket',
    'sse_events', 'notification', 'email', 'sms',
    'webhook', 'pao_notification', 'chat_operator'
  ));

CREATE INDEX IF NOT EXISTS idx_chat_conversations_channel
  ON chat_conversations(channel);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_prospect_id
  ON chat_conversations(prospect_id) WHERE prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_customer_id
  ON chat_conversations(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_status
  ON chat_conversations(status);

-- ─── chat_messages extensions ─────────────────────────────────────────────

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS message_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS sender_id text,
  ADD COLUMN IF NOT EXISTS recipient_id text,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'web_chat',
  ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS reply_to uuid,
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS authorization_context jsonb,
  ADD COLUMN IF NOT EXISTS audit_reference text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_direction_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_direction_check
  CHECK (direction IN ('inbound', 'outbound'));

ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_delivery_status_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_delivery_status_check
  CHECK (delivery_status IN (
    'pending', 'sent', 'delivered', 'read',
    'failed', 'suppressed', 'rate_limited', 'killed'
  ));

ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_processing_status_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_processing_status_check
  CHECK (processing_status IN ('pending', 'processed', 'failed', 'escalated'));

ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_content_type_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_content_type_check
  CHECK (content_type IN ('text', 'json', 'html', 'system'));

ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_channel_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_channel_check
  CHECK (channel IN (
    'heidi_core', 'web_chat', 'mobile_chat', 'websocket',
    'sse_events', 'notification', 'email', 'sms',
    'webhook', 'pao_notification', 'chat_operator'
  ));

-- Extend sender_type to include 'agent' and 'operator' for the unified layer
ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_sender_type_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_sender_type_check
  CHECK (sender_type IN ('user', 'assistant', 'system', 'agent', 'operator'));

-- Foreign key for reply chain
ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_reply_to_fkey;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_reply_to_fkey
  FOREIGN KEY (reply_to) REFERENCES chat_messages(id) ON DELETE SET NULL;

-- Indexes for the unified layer query patterns
CREATE INDEX IF NOT EXISTS idx_chat_messages_direction
  ON chat_messages(direction);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel
  ON chat_messages(channel);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_id
  ON chat_messages(sender_id) WHERE sender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient_id
  ON chat_messages(recipient_id) WHERE recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_delivery_status
  ON chat_messages(delivery_status);
CREATE INDEX IF NOT EXISTS idx_chat_messages_processing_status
  ON chat_messages(processing_status);
CREATE INDEX IF NOT EXISTS idx_chat_messages_provider_message_id
  ON chat_messages(provider_message_id) WHERE provider_message_id IS NOT NULL;

-- ─── operator_actions extensions ──────────────────────────────────────────

ALTER TABLE operator_actions
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS risk_level text,
  ADD COLUMN IF NOT EXISTS authorization_mode text,
  ADD COLUMN IF NOT EXISTS authorized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS policy_reference text,
  ADD COLUMN IF NOT EXISTS audit_reference text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE operator_actions
  DROP CONSTRAINT IF EXISTS operator_actions_risk_level_check;

ALTER TABLE operator_actions
  ADD CONSTRAINT operator_actions_risk_level_check
  CHECK (risk_level IN ('R0', 'R1', 'R2', 'R3', 'R4', 'R5') OR risk_level IS NULL);

ALTER TABLE operator_actions
  DROP CONSTRAINT IF EXISTS operator_actions_authorization_mode_check;

ALTER TABLE operator_actions
  ADD CONSTRAINT operator_actions_authorization_mode_check
  CHECK (authorization_mode IN (
    'autonomous', 'policy_authorized', 'human_required', 'prohibited'
  ) OR authorization_mode IS NULL);

-- ─── communication_events audit table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS communication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text UNIQUE NOT NULL,
  event_type text NOT NULL,
  channel text NOT NULL,
  conversation_id uuid,
  message_id text,
  actor text NOT NULL,
  action_type text,
  risk_level text,
  authorization_mode text,
  authorized boolean,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE communication_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_communication_events_event_type
  ON communication_events(event_type);
CREATE INDEX IF NOT EXISTS idx_communication_events_channel
  ON communication_events(channel);
CREATE INDEX IF NOT EXISTS idx_communication_events_conversation_id
  ON communication_events(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_communication_events_actor
  ON communication_events(actor);
CREATE INDEX IF NOT EXISTS idx_communication_events_created_at
  ON communication_events(created_at);

-- RLS policies for communication_events (service_role full access, others none)
CREATE POLICY "communication_events_service_all"
  ON communication_events
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ─── communication_kill_switch state table ────────────────────────────────

CREATE TABLE IF NOT EXISTS communication_kill_switch (
  id integer PRIMARY KEY DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  reason text,
  activated_at timestamptz,
  activated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_kill_switch_singleton CHECK (id = 1)
);

ALTER TABLE communication_kill_switch ENABLE ROW LEVEL SECURITY;

CREATE POLICY "communication_kill_switch_service_all"
  ON communication_kill_switch
  FOR ALL
  USING (true)
  WITH CHECK (true);

INSERT INTO communication_kill_switch (id, status)
VALUES (1, 'active')
ON CONFLICT (id) DO NOTHING;

-- ─── Grants ───────────────────────────────────────────────────────────────

GRANT ALL ON chat_conversations, chat_messages, operator_actions,
  communication_events, communication_kill_switch
  TO anon, authenticated, service_role;

-- ─── updated_at triggers ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_communication_events_updated_at ON communication_events;
-- communication_events has no updated_at column; skip trigger

DROP TRIGGER IF EXISTS trg_chat_conversations_updated_at ON chat_conversations;
CREATE TRIGGER trg_chat_conversations_updated_at
  BEFORE UPDATE ON chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_operator_actions_updated_at ON operator_actions;
CREATE TRIGGER trg_operator_actions_updated_at
  BEFORE UPDATE ON operator_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
