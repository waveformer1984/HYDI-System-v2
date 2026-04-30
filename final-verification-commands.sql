-- FINAL VERIFICATION - Run this after webhook test
SELECT event_id, type, status, processed_at, error_message, created_at
FROM webhook_events
ORDER BY created_at DESC
LIMIT 10;
