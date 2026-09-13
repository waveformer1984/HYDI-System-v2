-- Fix a real runtime bug left behind by 20260818120000_reconcile_notifications_schema.sql.
--
-- Problem:
--   The April schema (20260426122500_notifications_table.sql) defined
--   `type`, `recipient`, `channel`, `status`, and `template` as NOT NULL with
--   no defaults. The July reconcile migration added the July-style columns
--   (category, severity, title, body, device_id) additively but never
--   relaxed these April NOT NULL constraints.
--
--   lib/notifications/notify.js -- the current, intended insert path -- only
--   ever sets category/severity/title/body/device_id/metadata. On every real
--   database (the April migration always runs first, chronologically), every
--   call to notify.js's insert() currently fails with a NOT NULL violation on
--   `type`. This was caught by tests/migrations/20260915130000.test.js
--   inserting via the same July-only shape.
--
-- Fix:
--   Drop NOT NULL on the five April-only columns. This is additive/relaxing
--   only -- old callers that still explicitly set these columns are
--   unaffected; CHECK constraints on channel/status already pass on NULL
--   (Postgres CHECK is satisfied when any operand is NULL), so those remain
--   enforced whenever a value is actually provided.

alter table public.notifications alter column type drop not null;
alter table public.notifications alter column recipient drop not null;
alter table public.notifications alter column channel drop not null;
alter table public.notifications alter column status drop not null;
alter table public.notifications alter column template drop not null;
