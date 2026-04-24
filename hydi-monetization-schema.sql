-- HYDI Monetization Schema for ProtoForge
-- Project: akbnfovjdcobifeupvbn

-- Create HYDI subscriptions table
CREATE TABLE IF NOT EXISTS hydi_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            text UNIQUE NOT NULL,
  client_email         text NOT NULL,
  client_company       text NOT NULL,
  supabase_url         text,
  tier                 text NOT NULL CHECK (tier IN ('starter','pro','enterprise')),
  stripe_customer_id   text,
  stripe_sub_id        text,
  monthly_revenue      numeric(10,2) NOT NULL DEFAULT 99,
  features             text[] DEFAULT '{}',
  status               text NOT NULL DEFAULT 'active',
  activated_at         timestamptz DEFAULT now(),
  deactivated_at       timestamptz,
  created_at           timestamptz DEFAULT now()
);

-- Create client health runs table
CREATE TABLE IF NOT EXISTS hydi_client_health_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid REFERENCES hydi_subscriptions(id),
  client_id        text NOT NULL,
  overall_status   text NOT NULL,
  components       jsonb DEFAULT '{}',
  checked_at       timestamptz DEFAULT now()
);

-- Create schedules table
CREATE TABLE IF NOT EXISTS hydi_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid REFERENCES hydi_subscriptions(id),
  client_id        text UNIQUE NOT NULL,
  interval_minutes int DEFAULT 5,
  next_run         timestamptz DEFAULT now(),
  last_run         timestamptz,
  active           boolean DEFAULT true
);

-- Create MRR view
CREATE OR REPLACE VIEW hydi_mrr AS
SELECT
  tier,
  COUNT(*)                  AS clients,
  SUM(monthly_revenue)      AS mrr,
  SUM(monthly_revenue) * 12 AS arr
FROM hydi_subscriptions
WHERE status = 'active'
GROUP BY tier
ORDER BY mrr DESC;

-- Create fleet health view
CREATE OR REPLACE VIEW hydi_fleet_health AS
SELECT
  s.client_company,
  s.tier,
  s.monthly_revenue,
  r.overall_status AS last_status,
  r.checked_at     AS last_checked,
  EXTRACT(EPOCH FROM (NOW() - r.checked_at))/60 AS minutes_since_check
FROM hydi_subscriptions s
LEFT JOIN LATERAL (
  SELECT overall_status, checked_at
  FROM hydi_client_health_runs
  WHERE client_id = s.client_id
  ORDER BY checked_at DESC LIMIT 1
) r ON true
WHERE s.status = 'active'
ORDER BY s.monthly_revenue DESC;

-- Enable RLS
ALTER TABLE hydi_subscriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_client_health_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hydi_schedules          ENABLE ROW LEVEL SECURITY;

-- Service role policies
CREATE POLICY "service_role_all" ON hydi_subscriptions
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON hydi_client_health_runs
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON hydi_schedules
  FOR ALL USING (auth.role() = 'service_role');

-- Verify views
SELECT * FROM hydi_mrr;
SELECT * FROM hydi_fleet_health;
