-- Add 'operator_escalation' as a valid notification category.
--
-- The existing notifications table (20260715123000_notifications.sql)
-- has a CHECK constraint limiting categories to a fixed set. Escalation
-- notifications from EscalationNotifier/StuckJobDetector need their own
-- category so they route through the existing VAPID web-push system.
--
-- Idempotent: uses DROP CONSTRAINT + ADD CONSTRAINT.

alter table public.notifications
  drop constraint if exists notifications_category_check;

alter table public.notifications
  add constraint notifications_category_check
  check (category in (
    'worker_failure', 'security_event', 'deployment_failure', 'agent_crash',
    'task_completed', 'document_generated', 'build_completed', 'deployment_completed',
    'approval_required', 'destructive_action_confirmation',
    'operator_escalation'
  ));
