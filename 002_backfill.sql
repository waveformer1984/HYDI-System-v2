-- =====================================================
-- BACKFILL CUSTOMERS FROM EXISTING DATA
-- =====================================================

-- Insert unique customers from customer_services
INSERT INTO public.customers (email)
SELECT DISTINCT cs.customer_email
FROM public.customer_services cs
WHERE cs.customer_email IS NOT NULL
ON CONFLICT DO NOTHING;

-- Update customer_services with customer_id
UPDATE public.customer_services cs
SET customer_id = c.id
FROM public.customers c
WHERE lower(cs.customer_email) = lower(c.email)
  AND cs.customer_id IS NULL;

-- Update revenue_tracking with customer_id
UPDATE public.revenue_tracking rt
SET customer_id = c.id
FROM public.customers c
WHERE lower(rt.customer_email) = lower(c.email)
  AND rt.customer_id IS NULL;
