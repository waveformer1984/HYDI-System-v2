'use strict';
/**
 * Migration: add 'job_lead' to the notifications.category check constraint.
 * Heidi's job scout (lib/job-scout) raises one notification per new strong
 * lead via lib/notifications/notify.js createNotification.
 *
 * The constraint was created inline in 20260715123000_notifications.sql, so
 * it is dropped and re-created with the extended list. Idempotent.
 */

alter table public.notifications
  drop constraint if exists notifications_category_check;

alter table public.notifications
  add constraint notifications_category_check
  check (category in (
    'worker_failure', 'security_event', 'deployment_failure', 'agent_crash',
    'task_completed', 'document_generated', 'build_completed', 'deployment_completed',
    'approval_required', 'destructive_action_confirmation',
    'job_lead'
  ));
