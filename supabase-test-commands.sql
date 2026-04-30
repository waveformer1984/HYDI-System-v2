-- HYDI Supabase Integration Test Commands
-- Run these in Supabase SQL Editor for project akbnfovjdcobifeupvbn

-- Test 1: Simulate subscription activation
SELECT sync_hydi_stripe_subscription(
  'client_deploy_test',
  'deploy@protoforgeindustries.com',
  'ProtoForge Internal Test',
  'pro',
  'cus_deploy_test',
  'sub_deploy_test'
);

-- Test 2: Verify subscription was created
SELECT
  client_company,
  tier,
  monthly_revenue,
  features,
  status,
  activated_at
FROM hydi_subscriptions
WHERE client_id = 'client_deploy_test';

-- Test 3: Verify MRR view
SELECT * FROM hydi_mrr;

-- Test 4: Verify activation event was fired
SELECT event_type, payload, created_at
FROM event_bus_events
WHERE event_type = 'hydi:subscription_activated'
ORDER BY created_at DESC
LIMIT 1;

-- Test 5: Verify schedule was created
SELECT * FROM hydi_schedules WHERE client_id = 'client_deploy_test';

-- Cleanup after verification
DELETE FROM hydi_schedules    WHERE client_id = 'client_deploy_test';
DELETE FROM hydi_subscriptions WHERE client_id = 'client_deploy_test';

-- Expected results:
-- Test 1: Returns JSON with success=true, tier=pro, monthly_revenue=199
-- Test 2: Shows 1 row with tier=pro, monthly_revenue=199, status=active
-- Test 3: Shows pro tier with mrr=199 (may be empty if no other subscriptions)
-- Test 4: Shows hydi:subscription_activated event with client details
-- Test 5: Shows schedule with interval_minutes=5 for pro tier
