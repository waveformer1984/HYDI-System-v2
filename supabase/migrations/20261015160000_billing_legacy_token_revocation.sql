-- Phase 3: server-side revocation for stateless hbc1 legacy customer tokens.
-- Tokens carry payload { t, iat, exp, n }; revocations keyed by (tenant_id, n).
-- Tenant-wide emergency: min_valid_iat on billing_tenant_legacy_policy.

BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_legacy_token_revocations (
  revocation_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.billing_tenants(tenant_id) ON DELETE RESTRICT,
  token_nonce     text        NOT NULL,
  revoked_at      timestamptz NOT NULL DEFAULT now(),
  revoked_by      text,
  reason          text,
  UNIQUE (tenant_id, token_nonce)
);

CREATE INDEX IF NOT EXISTS billing_legacy_token_revocations_tenant_idx
  ON public.billing_legacy_token_revocations (tenant_id);

CREATE TABLE IF NOT EXISTS public.billing_tenant_legacy_policy (
  tenant_id       uuid        PRIMARY KEY REFERENCES public.billing_tenants(tenant_id) ON DELETE RESTRICT,
  min_valid_iat   bigint      NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.billing_legacy_token_revocations IS
  'Revoked hbc1 token nonces (payload field n). Verification fails closed when listed.';
COMMENT ON TABLE public.billing_tenant_legacy_policy IS
  'Tenant-wide legacy token floor: reject tokens with iat < min_valid_iat.';

ALTER TABLE public.billing_legacy_token_revocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_legacy_token_revocations_service_role ON public.billing_legacy_token_revocations;
DO $$ BEGIN
  CREATE POLICY billing_legacy_token_revocations_service_role ON public.billing_legacy_token_revocations
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.billing_tenant_legacy_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_tenant_legacy_policy_service_role ON public.billing_tenant_legacy_policy;
DO $$ BEGIN
  CREATE POLICY billing_tenant_legacy_policy_service_role ON public.billing_tenant_legacy_policy
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
