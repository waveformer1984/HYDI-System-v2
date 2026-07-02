-- Migration: 20260613000001_scope_rls_policies_to_service_role
--
-- Problem: migration 20260528000001 enabled RLS on conversation_threads,
-- rule_sets, compensation_events, and drift_log, but the
-- "service_role_all" policies were created with USING (true) WITH CHECK
-- (true) and no `TO` clause. Without a `TO` clause, a policy applies to
-- PUBLIC -- i.e. every role, including anon/authenticated -- which grants
-- unrestricted read/write to anyone with table privileges. RLS was
-- technically "enabled" (satisfying the Advisor check) but provided no
-- real protection.
--
-- Fix: drop and recreate each policy scoped explicitly TO service_role.

-- Guarded: these four tables are created elsewhere and may not exist on a
-- from-scratch local database (their creating migration is a .sql.skip). Only
-- adjust the policy when the table actually exists -- a no-op locally, correct on
-- remote. (DROP POLICY IF EXISTS still errors if the *table* is missing, hence the
-- to_regclass guard.)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversation_threads', 'rule_sets', 'compensation_events', 'drift_log']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "service_role_all" ON public.%I;', t);
      EXECUTE format('CREATE POLICY "service_role_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);', t);
    END IF;
  END LOOP;
END $$;
