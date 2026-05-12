-- Test insert
INSERT INTO hydi_events (event_id, timestamp, source, type) 
VALUES ('test-event-1', NOW(), 'manual', 'error');

-- Verify insert
SELECT * FROM hydi_events;
