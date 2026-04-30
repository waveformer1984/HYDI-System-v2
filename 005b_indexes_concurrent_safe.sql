-- Additional safe indexes for edge cases
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_cs_unique_safe
ON public.customer_services (customer_id, service_name)
WHERE customer_id IS NOT NULL;
