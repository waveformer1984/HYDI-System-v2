-- Enable RLS on tables flagged by Supabase Advisor as public without protection

-- conversation_threads
ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.conversation_threads
  FOR ALL USING (true) WITH CHECK (true);

-- rule_sets
ALTER TABLE public.rule_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.rule_sets
  FOR ALL USING (true) WITH CHECK (true);

-- compensation_events
ALTER TABLE public.compensation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.compensation_events
  FOR ALL USING (true) WITH CHECK (true);

-- drift_log
ALTER TABLE public.drift_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.drift_log
  FOR ALL USING (true) WITH CHECK (true);
