-- agent_bus: only service_role may insert or update rows.
-- Prevents clients from forging pending tasks or self-approving via REST/anon JWT.
-- SELECT for audit may be added later; today there is no authenticated read policy.

DROP POLICY IF EXISTS agent_bus_service_role ON public.agent_bus;

CREATE POLICY agent_bus_service_role_insert ON public.agent_bus
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY agent_bus_service_role_update ON public.agent_bus
  FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY agent_bus_service_role_delete ON public.agent_bus
  FOR DELETE TO service_role
  USING (true);

CREATE POLICY agent_bus_service_role_select ON public.agent_bus
  FOR SELECT TO service_role
  USING (true);
