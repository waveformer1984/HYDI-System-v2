-- FINAL DEPLOY VERIFICATION CHECKLIST
-- Run this after deployment to confirm everything is working

-- 1. Null safety checks
SELECT 'customer_services null customer_id' as check_name, COUNT(*) as count
FROM customer_services WHERE customer_id IS NULL
UNION ALL
SELECT 'revenue_tracking null customer_id' as check_name, COUNT(*) as count
FROM revenue_tracking WHERE customer_id IS NULL;

-- 2. Orphan detection
SELECT 'customer_services orphans' as check_name, COUNT(*) as count
FROM customer_services cs
LEFT JOIN customers c ON cs.customer_id = c.id
WHERE c.id IS NULL;

-- 3. Duplicate services check
SELECT 'duplicate services' as check_name, COUNT(*) as count
FROM (
  SELECT customer_id, service_name, COUNT(*) as cnt
  FROM customer_services
  GROUP BY customer_id, service_name
  HAVING COUNT(*) > 1
) duplicates;

-- 4. Webhook duplicates (should be 0)
SELECT 'webhook event duplicates' as check_name, COUNT(*) as count
FROM (
  SELECT event_id, COUNT(*) as cnt
  FROM webhook_events
  GROUP BY event_id
  HAVING COUNT(*) > 1
) duplicates;

-- 5. Index validity check
SELECT indexrelid::regclass as index_name, 'invalid index' as check_name, 1 as count
FROM pg_index
WHERE NOT indisvalid;

-- 6. Customer sync verification
SELECT 'customers without stripe_id' as check_name, COUNT(*) as count
FROM customers
WHERE stripe_customer_id IS NULL;

-- 7. Service status distribution
SELECT status, COUNT(*) as count
FROM customer_services
GROUP BY status;

-- 8. Recent webhook activity
SELECT status, COUNT(*) as count
FROM webhook_events
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY status;
