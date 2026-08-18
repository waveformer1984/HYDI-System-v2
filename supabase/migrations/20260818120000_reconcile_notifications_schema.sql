-- ============================================================================
-- Reconcile notifications schema — corrective forward migration
--
-- Problem:
--   20260426122500_notifications_table.sql creates public.notifications with
--   April-schema columns (type, recipient, channel, status, template, metadata,
--   created_at, updated_at).
--
--   20260715123000_notifications.sql attempts to create public.notifications
--   with July-schema columns (category, severity, title, body, device_id,
--   metadata, read_at, delivered_at, created_at) but uses CREATE TABLE IF NOT
--   EXISTS, which is a silent no-op when the table already exists from the
--   April migration.
--
--   Result: on any database where the April migration ran first (which is every
--   database, given chronological order), the July columns are missing, the
--   July indexes fail to create, and lib/notifications/notify.js (which
--   inserts category/severity/title/body/device_id) fails at runtime.
--
-- Fix:
--   This migration adds the July columns using ALTER TABLE ADD COLUMN IF NOT
--   EXISTS, creates the missing July indexes, and replaces the April RLS
--   policies with the July policy. April columns are preserved for backward
--   compatibility with existing callers (notification-service Edge Function,
--   heidi-service-automator, system-monitor-worker).
--
-- Safety:
--   - Additive: only adds columns, indexes, and policies. Does not drop columns.
--   - Idempotent: all statements use IF NOT EXISTS or DROP IF EXISTS + CREATE.
--   - Safe for fresh databases: if July schema already exists, all statements
--     are no-ops.
--   - Safe for existing databases: if April schema exists, July columns are
--     added without affecting existing data.
-- ============================================================================

-- Add July columns if they don't exist
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS severity text DEFAULT 'info';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Add July indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications (device_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON public.notifications (category);

-- Replace April RLS policies with the July unified policy
DROP POLICY IF EXISTS "notifications_select_service_role" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_service_role" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_service_role" ON public.notifications;
DROP POLICY IF EXISTS "notifications_service_all" ON public.notifications;
CREATE POLICY "notifications_service_all" ON public.notifications
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Ensure RLS is enabled (idempotent)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
