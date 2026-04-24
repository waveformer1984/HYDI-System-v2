-- RLS policy for webhook_events table
CREATE POLICY webhook_events_service_role
ON public.webhook_events
FOR ALL TO service_role
USING (true) WITH CHECK (true);
