-- =====================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =====================================================
-- ATTACH TRIGGERS SAFELY
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgname = 'cs_updated_at'
      AND t.tgrelid = 'public.customer_services'::regclass
      AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER cs_updated_at
    BEFORE UPDATE ON public.customer_services
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgname = 'cust_updated_at'
      AND t.tgrelid = 'public.customers'::regclass
      AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER cust_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgname = 'rev_updated_at'
      AND t.tgrelid = 'public.revenue_tracking'::regclass
      AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER rev_updated_at
    BEFORE UPDATE ON public.revenue_tracking
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

-- =====================================================
-- ENABLE ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE public.customer_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- REVOKE DEFAULT ACCESS
-- =====================================================
REVOKE ALL ON public.customer_services FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.revenue_tracking FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.webhook_events FROM PUBLIC, anon, authenticated;
