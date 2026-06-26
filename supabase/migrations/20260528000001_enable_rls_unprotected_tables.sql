-- Enable RLS on tables flagged by Supabase Advisor as public without protection

-- conversation_threads (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='conversation_threads') THEN
    ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_role_all" ON public.conversation_threads
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;

-- rule_sets (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='rule_sets') THEN
    ALTER TABLE public.rule_sets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_role_all" ON public.rule_sets
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;

-- compensation_events (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='compensation_events') THEN
    ALTER TABLE public.compensation_events ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_role_all" ON public.compensation_events
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;

-- drift_log (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='drift_log') THEN
    ALTER TABLE public.drift_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_role_all" ON public.drift_log
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;
