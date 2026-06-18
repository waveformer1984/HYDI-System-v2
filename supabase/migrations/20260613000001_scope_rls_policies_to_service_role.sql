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

-- conversation_threads
DROP POLICY IF EXISTS "service_role_all" ON public.conversation_threads;
CREATE POLICY "service_role_all" ON public.conversation_threads
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- rule_sets
DROP POLICY IF EXISTS "service_role_all" ON public.rule_sets;
CREATE POLICY "service_role_all" ON public.rule_sets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- compensation_events
DROP POLICY IF EXISTS "service_role_all" ON public.compensation_events;
CREATE POLICY "service_role_all" ON public.compensation_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- drift_log
DROP POLICY IF EXISTS "service_role_all" ON public.drift_log;
CREATE POLICY "service_role_all" ON public.drift_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
