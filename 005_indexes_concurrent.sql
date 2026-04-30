-- =====================================================
-- CONCURRENT INDEXES (NON-TRANSACTIONAL)
-- =====================================================

-- Case-insensitive email uniqueness
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS customers_email_lower_unique
  ON public.customers (lower(email));

-- Customer services performance indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cs_customer_status
  ON public.customer_services (customer_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cs_active
  ON public.customer_services (customer_id)
  WHERE status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cs_metadata
  ON public.customer_services
  USING gin (metadata);

-- Revenue tracking index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_customer
  ON public.revenue_tracking (customer_id);

-- Webhook events unique index
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS webhook_events_event_id_idx
  ON public.webhook_events (event_id);
