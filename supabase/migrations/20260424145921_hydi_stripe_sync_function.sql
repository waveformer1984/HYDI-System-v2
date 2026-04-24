-- Stripe Subscription Sync Function for HYDI
-- Project: akbnfovjdcobifeupvbn

CREATE OR REPLACE FUNCTION sync_hydi_stripe_subscription(
  p_client_id        text,
  p_client_email     text,
  p_client_company   text,
  p_tier             text,
  p_stripe_customer  text,
  p_stripe_sub_id    text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_price numeric;
  v_features text[];
  v_result jsonb;
BEGIN
  -- Map tier to price + features
  CASE p_tier
    WHEN 'starter'    THEN
      v_price    := 99;
      v_features := ARRAY['health_check','dashboard','email_alerts'];
    WHEN 'pro'        THEN
      v_price    := 199;
      v_features := ARRAY['health_check','dashboard','email_alerts',
                          'trends','auto_heal','escalation','slack'];
    WHEN 'enterprise' THEN
      v_price    := 299;
      v_features := ARRAY['health_check','dashboard','email_alerts',
                          'trends','auto_heal','escalation','slack',
                          'white_label','api_access'];
    ELSE
      RAISE EXCEPTION 'Unknown tier: %', p_tier;
  END CASE;

  INSERT INTO hydi_subscriptions (
    client_id, client_email, client_company,
    tier, stripe_customer_id, stripe_sub_id,
    monthly_revenue, features, status
  )
  VALUES (
    p_client_id, p_client_email, p_client_company,
    p_tier, p_stripe_customer, p_stripe_sub_id,
    v_price, v_features, 'active'
  )
  ON CONFLICT (client_id) DO UPDATE SET
    tier               = EXCLUDED.tier,
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    stripe_sub_id      = EXCLUDED.stripe_sub_id,
    monthly_revenue    = EXCLUDED.monthly_revenue,
    features           = EXCLUDED.features,
    status             = 'active',
    activated_at       = now();

  -- Auto-schedule health checks
  INSERT INTO hydi_schedules (client_id, interval_minutes, next_run)
  VALUES (p_client_id, CASE WHEN p_tier = 'starter' THEN 15 ELSE 5 END, now())
  ON CONFLICT (client_id) DO UPDATE SET
    active   = true,
    next_run = now();

  -- Emit activation event
  INSERT INTO event_bus_events (event_type, payload, status)
  VALUES (
    'hydi:subscription_activated',
    jsonb_build_object(
      'client_id',     p_client_id,
      'company',       p_client_company,
      'tier',          p_tier,
      'monthly_revenue', v_price,
      'activated_at',  now()
    ),
    'queued'
  );

  RETURN jsonb_build_object(
    'success',          true,
    'client_id',        p_client_id,
    'tier',             p_tier,
    'monthly_revenue',  v_price,
    'features',         v_features
  );
END;
$$;

-- Test the function
SELECT sync_hydi_stripe_subscription(
  'client_test_001',
  'test@example.com',
  'Test Company LLC',
  'pro',
  'cus_test123',
  'sub_test123'
);