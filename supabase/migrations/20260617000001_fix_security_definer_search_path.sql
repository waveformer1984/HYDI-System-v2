-- Fix function_search_path_mutable advisory for all SECURITY DEFINER functions
-- that had no pinned search_path. Setting 'public, extensions, pg_catalog' ensures
-- pgcrypto functions (gen_random_bytes, digest), extension helpers, and qualified
-- public-schema references all resolve without breaking existing callers.
-- Four functions already have SET search_path = public (keeper_auto_escalate,
-- get_hydi_context, expire_stale_memories, calibrate_protoforge_decisions).
-- Those use unqualified table names and are addressed in Sprint 3 with a
-- full body refactor to use qualified names before switching to search_path = ''.

-- ── Keymaker core (002_keymaker_functions.sql) ────────────────────────────────

ALTER FUNCTION public.keymaker_issue_key(UUID, TEXT, TEXT, TEXT[], TEXT[], INTEGER, JSONB)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.keymaker_validate_and_route(TEXT, TEXT, TEXT, TEXT, JSONB)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.oracle_calculate_behavior_score(UUID)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.oracle_predict_next_action(UUID)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.agent_create_job(TEXT, JSONB, INTEGER, TEXT, TEXT)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.agent_claim_job(TEXT)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.agent_complete_job(TEXT, TEXT, JSONB, TEXT)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.agent_retry_failed_jobs()
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.neo_kill_switch(BOOLEAN, TEXT)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.neo_break_glass_access(UUID, TEXT, INTEGER)
  SET search_path = 'public', 'extensions', 'pg_catalog';

-- ── Stripe sync (20260424145921_hydi_stripe_sync_function.sql) ────────────────

ALTER FUNCTION public.sync_hydi_stripe_subscription(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  SET search_path = 'public', 'extensions', 'pg_catalog';

-- ── Tool executor RPC (20260426121100_tool_executor_rpc_functions.sql) ─────────

ALTER FUNCTION public.tool_create_invoice(UUID, JSONB)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.tool_pause_subscription(UUID, JSONB)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.tool_create_support_ticket(UUID, JSONB)
  SET search_path = 'public', 'extensions', 'pg_catalog';

-- ── Chat operator notifications (20260426123000) ──────────────────────────────

ALTER FUNCTION public.tool_send_notification(UUID, JSONB)
  SET search_path = 'public', 'extensions', 'pg_catalog';

ALTER FUNCTION public.send_completion_notification(UUID, TEXT, TEXT, JSONB, TEXT, TEXT)
  SET search_path = 'public', 'extensions', 'pg_catalog';

-- ── Billing retry cron (20260426123500_billing_retry_cron.sql) ───────────────

ALTER FUNCTION public.get_billing_retry_health()
  SET search_path = 'public', 'extensions', 'pg_catalog';
