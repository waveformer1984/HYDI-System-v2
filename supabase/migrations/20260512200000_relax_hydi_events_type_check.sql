-- 20260512200000_relax_hydi_events_type_check.sql
--
-- The original hydi_events.type CHECK was locked to ('error','task','info').
-- That made sense for v1 (3-channel ingest from protoforge-mock) but blocks
-- every new domain the semantic router introduces (outreach, cad, audio,
-- analysis, repair, research, vision, diagnostic, work, log, plus future
-- HYDI-Ursula services).
--
-- We replace the enum-style constraint with a SHAPE constraint: lowercase
-- snake_case identifier, 1-50 chars. This keeps validation (no empty strings,
-- no SQL-injection-shaped garbage, no massive blobs) but stops requiring an
-- ALTER every time a new domain is added.
--
-- Per the Cascade Golden Rule: "Execution is not the default state. Verified
-- safety is." — we're keeping verification, just making the verifier smarter.

ALTER TABLE hydi_events
  DROP CONSTRAINT IF EXISTS hydi_events_type_check;

ALTER TABLE hydi_events
  ADD CONSTRAINT hydi_events_type_check
  CHECK (type ~ '^[a-z][a-z0-9_]{0,49}$');

-- Same problem affects status, but status really is a finite set. Just
-- expand it slightly so the semantic router can use it cleanly.
ALTER TABLE hydi_events
  DROP CONSTRAINT IF EXISTS hydi_events_status_check;

ALTER TABLE hydi_events
  ADD CONSTRAINT hydi_events_status_check
  CHECK (status IN ('pending','queued','processing','processed','failed','dead_letter'));

COMMENT ON CONSTRAINT hydi_events_type_check ON hydi_events IS
  'Type must be lowercase snake_case, 1-50 chars. Domains are open-ended; the application layer (core/capability-registry.js) owns the canonical list.';
