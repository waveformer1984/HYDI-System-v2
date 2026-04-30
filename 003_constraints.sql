-- =====================================================
-- CONSTRAINTS AND FOREIGN KEYS
-- =====================================================

-- Safe NOT NULL enforcement only when no NULLs exist
DO $$
BEGIN
  -- customer_services.customer_id NOT NULL only when safe
  IF NOT EXISTS (
    SELECT 1
    FROM public.customer_services
    WHERE customer_id IS NULL
  ) THEN
    ALTER TABLE public.customer_services
      ALTER COLUMN customer_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'Skipping customer_services.customer_id NOT NULL; NULL rows remain';
  END IF;

  -- revenue_tracking.customer_id NOT NULL only when safe
  IF NOT EXISTS (
    SELECT 1
    FROM public.revenue_tracking
    WHERE customer_id IS NULL
  ) THEN
    ALTER TABLE public.revenue_tracking
      ALTER COLUMN customer_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'Skipping revenue_tracking.customer_id NOT NULL; NULL rows remain';
  END IF;
END
$$;

-- Add unique constraint for customer services
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_services_unique'
  ) THEN
    ALTER TABLE public.customer_services
      ADD CONSTRAINT customer_services_unique
      UNIQUE (customer_id, service_name);
  END IF;
END
$$;

-- Add foreign keys as NOT VALID first (lower impact), validate afterward
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_services_customer_id_fkey'
  ) THEN
    ALTER TABLE public.customer_services
      ADD CONSTRAINT customer_services_customer_id_fkey
      FOREIGN KEY (customer_id)
      REFERENCES public.customers(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'revenue_tracking_customer_id_fkey'
  ) THEN
    ALTER TABLE public.revenue_tracking
      ADD CONSTRAINT revenue_tracking_customer_id_fkey
      FOREIGN KEY (customer_id)
      REFERENCES public.customers(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END
$$;

-- Validate constraints
ALTER TABLE public.customer_services
  VALIDATE CONSTRAINT customer_services_customer_id_fkey;

ALTER TABLE public.revenue_tracking
  VALIDATE CONSTRAINT revenue_tracking_customer_id_fkey;
