-- Final verification queries
SELECT stripe_event_id, event_type, processed, created_at
FROM webhook_events
ORDER BY created_at DESC
LIMIT 5;

SELECT tier, clients, mrr, arr FROM hydi_mrr;

SELECT client_company, tier, monthly_revenue, last_status 
FROM hydi_fleet_health 
LIMIT 5;
