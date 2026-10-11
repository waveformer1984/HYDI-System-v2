-- REVENUE STREAMS MODULE — slice 1: catalog → checkout → verified payment →
-- entitlement → metered usage → revenue reporting.
--
-- Design doc: docs/billing/REVENUE_STREAMS_MODULE.md
--
-- Everything is namespaced `billing_*` and is additive: no existing table,
-- column or row is altered. The legacy commercial tables (hydi_subscriptions,
-- customer_services, webhook_events, financial_ledger) keep working untouched;
-- this module does not read or write them.
--
-- Money is integer minor units (bigint, e.g. cents). Provider costs are integer
-- micro-units of the cost currency (1 USD = 1,000,000 micros). No floating-point
-- column holds a balance.
--
-- Concurrency-critical operations (usage reservation/finalize/release and
-- webhook claim) are SQL functions that take row locks, so two concurrent
-- requests can never both pass a quota check that only one of them fits.
--
-- Effect on the database (when applied):
--   + 13 billing_* tables, 1 append-only trigger, 1 price-immutability trigger
--   + functions billing_reserve_usage / billing_finalize_usage /
--     billing_release_usage / billing_claim_webhook_event
--   + seed rows in billing_revenue_streams (the six existing Stripe Connect
--     streams + hydi_platform)
--   RLS enabled on every new table; only service_role may access.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Revenue streams (reporting dimension)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_revenue_streams (
  stream_key   text PRIMARY KEY CHECK (stream_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name         text NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.billing_revenue_streams (stream_key, name) VALUES ('hydi_platform', 'Hydi(ai) platform subscriptions') ON CONFLICT (stream_key) DO NOTHING;
INSERT INTO public.billing_revenue_streams (stream_key, name) VALUES ('galactic_bytes', 'Galactic Bytes') ON CONFLICT (stream_key) DO NOTHING;
INSERT INTO public.billing_revenue_streams (stream_key, name) VALUES ('detailer_bot', 'Detailer Bot') ON CONFLICT (stream_key) DO NOTHING;
INSERT INTO public.billing_revenue_streams (stream_key, name) VALUES ('lipi_v2', 'LIPI v2') ON CONFLICT (stream_key) DO NOTHING;
INSERT INTO public.billing_revenue_streams (stream_key, name) VALUES ('protogrance_aromatics', 'ProtoGrance Aromatics') ON CONFLICT (stream_key) DO NOTHING;
INSERT INTO public.billing_revenue_streams (stream_key, name) VALUES ('rezonate', 'Rezonate') ON CONFLICT (stream_key) DO NOTHING;
INSERT INTO public.billing_revenue_streams (stream_key, name) VALUES ('waveformer_studio', 'Waveformer Studio') ON CONFLICT (stream_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tenants (the billing account; one paying customer organisation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_tenants (
  tenant_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid,          -- optional link to public.customers
  name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email                 text NOT NULL CHECK (position('@' IN email) > 1),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  provider              text NOT NULL DEFAULT 'stripe',
  provider_customer_id  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_customer_id)
);

-- ---------------------------------------------------------------------------
-- Catalog: product → plan → price version
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_products (
  product_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key     text NOT NULL UNIQUE CHECK (product_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  revenue_stream  text NOT NULL REFERENCES public.billing_revenue_streams(stream_key),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_plans (
  plan_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES public.billing_products(product_id) ON DELETE RESTRICT,
  plan_key     text NOT NULL UNIQUE CHECK (plan_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  -- features: JSON array of feature keys, e.g. ["ai_completions","api_access"]
  features     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(features) = 'array'),
  -- limits: { "<feature_key>": <integer per billing period>, "seats": <int> }
  -- A feature in `features` with no entry in `limits` is unlimited.
  limits       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limits) = 'object'),
  sort_order   integer NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_price_versions (
  price_version_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id            uuid NOT NULL REFERENCES public.billing_plans(plan_id) ON DELETE RESTRICT,
  version            integer NOT NULL CHECK (version >= 1),
  currency           text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  unit_amount_minor  bigint NOT NULL CHECK (unit_amount_minor >= 0),
  billing_interval   text NOT NULL CHECK (billing_interval IN ('month', 'year')),
  interval_count     integer NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 12),
  trial_days         integer NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 90),
  provider           text NOT NULL DEFAULT 'stripe',
  provider_price_id  text,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version),
  UNIQUE (provider, provider_price_id),
  CHECK (status = 'draft' OR provider_price_id IS NOT NULL)
);

-- Agreed prices are immutable once published: a price change is a new
-- version, so existing subscribers keep the version they agreed to
-- (grandfathering). Only status/published_at may change afterwards, and a
-- version can never return to draft.
CREATE OR REPLACE FUNCTION public.billing_price_version_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.unit_amount_minor IS DISTINCT FROM OLD.unit_amount_minor
       OR NEW.billing_interval IS DISTINCT FROM OLD.billing_interval
       OR NEW.interval_count IS DISTINCT FROM OLD.interval_count
       OR NEW.trial_days IS DISTINCT FROM OLD.trial_days
       OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.provider_price_id IS DISTINCT FROM OLD.provider_price_id THEN
      RAISE EXCEPTION 'billing_price_versions: published price version % is immutable; create a new version', OLD.price_version_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'draft' THEN
      RAISE EXCEPTION 'billing_price_versions: cannot return a published price version to draft'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS billing_price_version_guard ON public.billing_price_versions;
CREATE TRIGGER billing_price_version_guard
  BEFORE UPDATE ON public.billing_price_versions
  FOR EACH ROW EXECUTE FUNCTION public.billing_price_version_guard();

-- ---------------------------------------------------------------------------
-- Checkout intents (server-side record of every checkout we started)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_checkout_intents (
  intent_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.billing_tenants(tenant_id) ON DELETE RESTRICT,
  price_version_id     uuid NOT NULL REFERENCES public.billing_price_versions(price_version_id),
  idempotency_key      text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  provider             text NOT NULL DEFAULT 'stripe',
  provider_session_id  text,
  checkout_url         text,
  status               text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'open', 'completed', 'expired', 'failed')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (provider, provider_session_id)
);

-- ---------------------------------------------------------------------------
-- Subscriptions (projection of provider subscription state)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  subscription_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES public.billing_tenants(tenant_id) ON DELETE RESTRICT,
  price_version_id          uuid NOT NULL REFERENCES public.billing_price_versions(price_version_id),
  provider                  text NOT NULL DEFAULT 'stripe',
  provider_subscription_id  text NOT NULL,
  status                    text NOT NULL CHECK (status IN (
                              'incomplete', 'incomplete_expired', 'trialing', 'active',
                              'past_due', 'unpaid', 'canceled', 'paused')),
  cancel_at_period_end      boolean NOT NULL DEFAULT false,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  trial_end                 timestamptz,
  past_due_since            timestamptz,
  canceled_at               timestamptz,
  ended_at                  timestamptz,
  access_hold               text,          -- e.g. 'dispute' — blocks access regardless of status
  provider_state_at         timestamptz NOT NULL,  -- provider timestamp of the snapshot applied
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id)
);
CREATE INDEX IF NOT EXISTS billing_subscriptions_tenant_idx ON public.billing_subscriptions (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Entitlements (what a tenant may use, separate from what they pay)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_entitlements (
  entitlement_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.billing_tenants(tenant_id) ON DELETE RESTRICT,
  feature_key     text NOT NULL CHECK (feature_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  source_type     text NOT NULL CHECK (source_type IN ('subscription', 'manual')),
  source_id       uuid NOT NULL,
  limit_units     bigint CHECK (limit_units IS NULL OR limit_units >= 0),  -- NULL = unlimited
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  access_until    timestamptz,         -- NULL or past = no access
  status          text NOT NULL CHECK (status IN ('active', 'revoked')),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_key, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS billing_entitlements_lookup_idx
  ON public.billing_entitlements (tenant_id, feature_key) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Usage (reservation ledger; one row per idempotency key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_usage_events (
  usage_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.billing_tenants(tenant_id) ON DELETE RESTRICT,
  entitlement_id    uuid NOT NULL REFERENCES public.billing_entitlements(entitlement_id),
  feature_key       text NOT NULL,
  idempotency_key   text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  units_reserved    bigint NOT NULL CHECK (units_reserved > 0),
  units_committed   bigint NOT NULL DEFAULT 0 CHECK (units_committed >= 0 AND units_committed <= units_reserved),
  status            text NOT NULL CHECK (status IN ('reserved', 'committed', 'released')),
  period_start      timestamptz NOT NULL,
  reserved_at       timestamptz NOT NULL,
  expires_at        timestamptz NOT NULL,
  finalized_at      timestamptz,
  attempts          integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS billing_usage_period_idx
  ON public.billing_usage_events (entitlement_id, period_start, status);

-- ---------------------------------------------------------------------------
-- Provider (AI) cost records — internal cost, never customer billing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_provider_cost_records (
  cost_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.billing_tenants(tenant_id) ON DELETE RESTRICT,
  usage_id        uuid REFERENCES public.billing_usage_events(usage_id),
  job_ref         text NOT NULL,
  provider        text NOT NULL,
  model           text,
  input_units     bigint CHECK (input_units IS NULL OR input_units >= 0),
  output_units    bigint CHECK (output_units IS NULL OR output_units >= 0),
  cost_currency   text NOT NULL DEFAULT 'usd' CHECK (cost_currency ~ '^[a-z]{3}$'),
  cost_micros     bigint CHECK (cost_micros IS NULL OR cost_micros >= 0),
  cost_status     text NOT NULL CHECK (cost_status IN ('estimated', 'confirmed', 'unpriced')),
  rate_version    text,
  attempt         integer NOT NULL DEFAULT 1,
  succeeded       boolean NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (cost_status = 'unpriced' OR cost_micros IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS billing_costs_tenant_time_idx ON public.billing_provider_cost_records (tenant_id, created_at);

-- ---------------------------------------------------------------------------
-- Payments and refunds (cash, as reported by the provider)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_payments (
  payment_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES public.billing_tenants(tenant_id) ON DELETE RESTRICT,
  subscription_id          uuid REFERENCES public.billing_subscriptions(subscription_id),
  provider                 text NOT NULL DEFAULT 'stripe',
  provider_invoice_id      text NOT NULL,
  provider_payment_intent  text,
  status                   text NOT NULL CHECK (status IN ('succeeded', 'failed', 'refunded', 'partially_refunded', 'disputed')),
  currency                 text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  amount_minor             bigint NOT NULL CHECK (amount_minor >= 0),
  amount_refunded_minor    bigint NOT NULL DEFAULT 0 CHECK (amount_refunded_minor >= 0),
  amount_disputed_minor    bigint NOT NULL DEFAULT 0 CHECK (amount_disputed_minor >= 0),
  tax_minor                bigint CHECK (tax_minor IS NULL OR tax_minor >= 0),
  fee_minor                bigint CHECK (fee_minor IS NULL OR fee_minor >= 0),
  hosted_invoice_url       text,
  occurred_at              timestamptz NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_invoice_id)
);
CREATE INDEX IF NOT EXISTS billing_payments_tenant_idx ON public.billing_payments (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS billing_payments_pi_idx ON public.billing_payments (provider_payment_intent);

CREATE TABLE IF NOT EXISTS public.billing_refunds (
  refund_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          uuid NOT NULL REFERENCES public.billing_payments(payment_id),
  tenant_id           uuid NOT NULL REFERENCES public.billing_tenants(tenant_id),
  provider            text NOT NULL DEFAULT 'stripe',
  provider_refund_id  text NOT NULL,
  amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
  currency            text NOT NULL,
  status              text NOT NULL,
  occurred_at         timestamptz NOT NULL,
  UNIQUE (provider, provider_refund_id)
);

-- ---------------------------------------------------------------------------
-- Webhook events (durable inbox; stored BEFORE processing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  event_row_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider             text NOT NULL,
  provider_event_id    text NOT NULL,
  event_type           text NOT NULL,
  livemode             boolean NOT NULL,
  provider_created_at  timestamptz NOT NULL,
  payload              jsonb NOT NULL,
  status               text NOT NULL DEFAULT 'received'
                         CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed', 'dead_letter')),
  attempts             integer NOT NULL DEFAULT 0,
  last_error           text,
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  locked_until         timestamptz,
  received_at          timestamptz NOT NULL DEFAULT now(),
  processed_at         timestamptz,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS billing_webhook_due_idx
  ON public.billing_webhook_events (next_attempt_at) WHERE status IN ('received', 'failed', 'processing');

-- ---------------------------------------------------------------------------
-- Audit (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_audit_events (
  audit_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type   text NOT NULL CHECK (actor_type IN ('operator', 'customer', 'provider', 'system')),
  actor_id     text NOT NULL,
  action       text NOT NULL,
  target_type  text NOT NULL,
  target_id    text NOT NULL,
  tenant_id    uuid,
  reason       text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_audit_tenant_idx ON public.billing_audit_events (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.billing_audit_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'billing_audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS billing_audit_append_only ON public.billing_audit_events;
CREATE TRIGGER billing_audit_append_only
  BEFORE UPDATE OR DELETE ON public.billing_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.billing_audit_append_only();

-- ---------------------------------------------------------------------------
-- Atomic usage reservation.
--
-- Locks the tenant's active entitlement row for the feature, so concurrent
-- reservations for the same tenant+feature serialize here. Within the lock:
--   * an existing row for the idempotency key is returned unchanged
--     ('duplicate'), or revived if it was released and quota still allows
--     ('reserved' with attempts+1) — a retry after a failure (or after an
--     unfinalized reservation expired) is permitted, a retry after a
--     success is never charged twice;
--   * expired 'reserved' rows do not count against quota;
--   * used + requested > limit → 'quota_exceeded'.
-- Outcomes: reserved | duplicate | not_entitled | quota_exceeded
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_reserve_usage(
  p_tenant_id uuid,
  p_feature_key text,
  p_units bigint,
  p_idempotency_key text,
  p_now timestamptz,
  p_ttl_seconds integer
) RETURNS TABLE (outcome text, usage_id uuid, usage_status text, limit_units bigint, used_units bigint)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ent   public.billing_entitlements%ROWTYPE;
  v_row   public.billing_usage_events%ROWTYPE;
  v_used  bigint;
BEGIN
  IF p_units IS NULL OR p_units <= 0 THEN
    RAISE EXCEPTION 'units must be positive' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_ent FROM public.billing_entitlements e
   WHERE e.tenant_id = p_tenant_id AND e.feature_key = p_feature_key
     AND e.status = 'active' AND e.access_until IS NOT NULL AND e.access_until > p_now
   ORDER BY e.limit_units IS NULL DESC, e.limit_units DESC
   LIMIT 1
   FOR UPDATE;

  SELECT * INTO v_row FROM public.billing_usage_events u
   WHERE u.tenant_id = p_tenant_id AND u.idempotency_key = p_idempotency_key
   FOR UPDATE;

  -- A reservation that expired without being finalized (worker crashed
  -- mid-operation) is treated like a released one: it was never charged, so
  -- the retry may reserve again.
  IF FOUND AND v_row.status <> 'released'
     AND NOT (v_row.status = 'reserved' AND v_row.expires_at <= p_now) THEN
    RETURN QUERY SELECT 'duplicate'::text, v_row.usage_id, v_row.status, v_ent.limit_units, NULL::bigint;
    RETURN;
  END IF;

  IF v_ent.entitlement_id IS NULL THEN
    RETURN QUERY SELECT 'not_entitled'::text, v_row.usage_id, v_row.status, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN u.status = 'committed' THEN u.units_committed ELSE u.units_reserved END), 0)
    INTO v_used
    FROM public.billing_usage_events u
   WHERE u.entitlement_id = v_ent.entitlement_id
     AND u.period_start = v_ent.period_start
     AND (u.status = 'committed' OR (u.status = 'reserved' AND u.expires_at > p_now));

  IF v_ent.limit_units IS NOT NULL AND v_used + p_units > v_ent.limit_units THEN
    RETURN QUERY SELECT 'quota_exceeded'::text, v_row.usage_id, v_row.status, v_ent.limit_units, v_used;
    RETURN;
  END IF;

  IF v_row.usage_id IS NOT NULL THEN
    UPDATE public.billing_usage_events u
       SET status = 'reserved', units_reserved = p_units, units_committed = 0,
           entitlement_id = v_ent.entitlement_id, period_start = v_ent.period_start,
           reserved_at = p_now, expires_at = p_now + make_interval(secs => p_ttl_seconds),
           finalized_at = NULL, attempts = u.attempts + 1
     WHERE u.usage_id = v_row.usage_id;
    RETURN QUERY SELECT 'reserved'::text, v_row.usage_id, 'reserved'::text, v_ent.limit_units, v_used + p_units;
    RETURN;
  END IF;

  INSERT INTO public.billing_usage_events
    (tenant_id, entitlement_id, feature_key, idempotency_key, units_reserved, status,
     period_start, reserved_at, expires_at)
  VALUES
    (p_tenant_id, v_ent.entitlement_id, p_feature_key, p_idempotency_key, p_units, 'reserved',
     v_ent.period_start, p_now, p_now + make_interval(secs => p_ttl_seconds))
  RETURNING billing_usage_events.usage_id INTO v_row.usage_id;

  RETURN QUERY SELECT 'reserved'::text, v_row.usage_id, 'reserved'::text, v_ent.limit_units, v_used + p_units;
END $$;

-- Commit actual units (<= reserved). Idempotent: committing an already
-- committed row returns 'duplicate' and changes nothing.
-- Outcomes: committed | duplicate | not_found | released
CREATE OR REPLACE FUNCTION public.billing_finalize_usage(
  p_usage_id uuid, p_units bigint, p_now timestamptz
) RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.billing_usage_events%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.billing_usage_events WHERE usage_id = p_usage_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_row.status = 'committed' THEN RETURN 'duplicate'; END IF;
  IF v_row.status = 'released' THEN RETURN 'released'; END IF;
  UPDATE public.billing_usage_events
     SET status = 'committed',
         units_committed = LEAST(GREATEST(COALESCE(p_units, v_row.units_reserved), 0), v_row.units_reserved),
         finalized_at = p_now
   WHERE usage_id = p_usage_id;
  RETURN 'committed';
END $$;

-- Release a reservation after a failed operation. Never releases committed usage.
-- Outcomes: released | not_found | committed (refused) | duplicate (already released)
CREATE OR REPLACE FUNCTION public.billing_release_usage(
  p_usage_id uuid, p_now timestamptz
) RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.billing_usage_events%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.billing_usage_events WHERE usage_id = p_usage_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_row.status = 'committed' THEN RETURN 'committed'; END IF;
  IF v_row.status = 'released' THEN RETURN 'duplicate'; END IF;
  UPDATE public.billing_usage_events
     SET status = 'released', units_committed = 0, finalized_at = p_now
   WHERE usage_id = p_usage_id;
  RETURN 'released';
END $$;

-- Claim a webhook event for processing. Exactly one concurrent caller wins.
-- A 'processing' row whose lock expired (crashed worker) is reclaimable.
CREATE OR REPLACE FUNCTION public.billing_claim_webhook_event(
  p_event_row_id uuid, p_now timestamptz, p_lock_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.billing_webhook_events
     SET status = 'processing', attempts = attempts + 1,
         locked_until = p_now + make_interval(secs => p_lock_seconds)
   WHERE event_row_id = p_event_row_id
     AND (status IN ('received', 'failed')
          OR (status = 'processing' AND locked_until < p_now));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END $$;

-- ---------------------------------------------------------------------------
-- Row level security: service_role only. Customer access is mediated by the
-- server (lib/billing), which authorizes every request against tenant_id.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'billing_revenue_streams', 'billing_tenants', 'billing_products', 'billing_plans',
    'billing_price_versions', 'billing_checkout_intents', 'billing_subscriptions',
    'billing_entitlements', 'billing_usage_events', 'billing_provider_cost_records',
    'billing_payments', 'billing_refunds', 'billing_webhook_events', 'billing_audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role_all', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t || '_service_role_all', t);
    END IF;
  END LOOP;

  -- Functions are EXECUTE-able by PUBLIC by default; restrict to service_role.
  REVOKE ALL ON FUNCTION public.billing_reserve_usage(uuid, text, bigint, text, timestamptz, integer) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.billing_finalize_usage(uuid, bigint, timestamptz) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.billing_release_usage(uuid, timestamptz) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.billing_claim_webhook_event(uuid, timestamptz, integer) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.billing_reserve_usage(uuid, text, bigint, text, timestamptz, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.billing_finalize_usage(uuid, bigint, timestamptz) TO service_role;
    GRANT EXECUTE ON FUNCTION public.billing_release_usage(uuid, timestamptz) TO service_role;
    GRANT EXECUTE ON FUNCTION public.billing_claim_webhook_event(uuid, timestamptz, integer) TO service_role;
  END IF;
END $$;

COMMIT;
