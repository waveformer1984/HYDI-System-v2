-- STEP 2A: Seed first health run
INSERT INTO system_health_runs (
  overall_status,
  components,
  issues,
  warnings,
  created_at
) VALUES (
  'OK',
  '{
    "queue":      {"status": "OK", "queued": 0, "done": 0, "failed": 0, "dead": 0, "total": 0},
    "eventFlow":  {"status": "OK", "recentCount": 0, "lastEventMinutesAgo": 1},
    "revenue":    {"status": "WARNING", "payments24h": 0, "revenue24h": 0},
    "automation": {"status": "OK", "heartbeats5min": 1}
  }'::jsonb,
  '[]'::jsonb,
  '["WARNING: No revenue in last 24 hours"]'::jsonb,
  now()
);

-- STEP 2B: Seed 5 more runs for trends data
INSERT INTO system_health_runs (overall_status, components, issues, warnings, created_at)
SELECT
  CASE (row_number() OVER ())
    WHEN 1 THEN 'OK'
    WHEN 2 THEN 'OK'
    WHEN 3 THEN 'WARNING'
    WHEN 4 THEN 'OK'
    WHEN 5 THEN 'OK'
  END,
  '{
    "queue":      {"status": "OK", "queued": 0, "done": 15, "failed": 0, "dead": 0, "total": 15},
    "eventFlow":  {"status": "OK", "recentCount": 12, "lastEventMinutesAgo": 2},
    "revenue":    {"status": "WARNING", "payments24h": 0, "revenue24h": 0},
    "automation": {"status": "OK", "heartbeats5min": 1}
  }'::jsonb,
  '[]'::jsonb,
  '["WARNING: No revenue in last 24 hours"]'::jsonb,
  now() - (row_number() OVER () * interval '2 minutes')
FROM generate_series(1,5) s(i);

-- STEP 2C: Seed ProtoForge as internal subscriber
SELECT sync_hydi_stripe_subscription(
  'client_protoforge_internal',
  'j.arenstein@protoforgeindustries.com',
  'ProtoForge Industries',
  'enterprise',
  'cus_protoforge',
  'sub_protoforge_internal'
);

-- STEP 2D: Verify views
SELECT overall_status, created_at
FROM system_health_runs
ORDER BY created_at DESC LIMIT 3;

SELECT
  current_status,
  trend_status,
  trend_reason,
  jobs_queued,
  jobs_failed,
  events_last_hour,
  auto_heals_24h
FROM system_dashboard;

SELECT * FROM hydi_mrr;
SELECT * FROM hydi_fleet_health;

SELECT analyze_health_trends();
SELECT evaluate_system_escalation();
