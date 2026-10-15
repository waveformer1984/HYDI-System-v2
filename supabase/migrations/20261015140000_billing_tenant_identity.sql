-- Billing customer identity (Phase 2): Supabase Auth membership + Walkie owner bindings.
-- Additive, idempotent. Service-role only (same as billing_* slice 1).

BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_tenant_members (
  member_id     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.billing_tenants(tenant_id) ON DELETE RESTRICT,
  auth_user_id  uuid        NOT NULL,
  role          text        NOT NULL CHECK (role IN ('owner', 'billing_admin', 'member')),
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, auth_user_id)
);

CREATE INDEX IF NOT EXISTS billing_tenant_members_auth_user_idx
  ON public.billing_tenant_members (auth_user_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.billing_walkie_tenant_bindings (
  binding_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     text        NOT NULL,
  tenant_id     uuid        NOT NULL REFERENCES public.billing_tenants(tenant_id) ON DELETE RESTRICT,
  role          text        NOT NULL DEFAULT 'owner' CHECK (role = 'owner'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  UNIQUE (device_id)
);

COMMENT ON TABLE public.billing_tenant_members IS
  'Maps Supabase Auth users to billing tenants. Tenant id for customer routes comes from membership, never the request body.';
COMMENT ON TABLE public.billing_walkie_tenant_bindings IS
  'Explicit operator-approved link between a Walkie device_id and a billing tenant (owner workflow). Pairing alone does not create a row here.';

ALTER TABLE public.billing_tenant_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_tenant_members_service_role ON public.billing_tenant_members;
DO $$ BEGIN
  CREATE POLICY billing_tenant_members_service_role ON public.billing_tenant_members
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.billing_walkie_tenant_bindings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_walkie_tenant_bindings_service_role ON public.billing_walkie_tenant_bindings;
DO $$ BEGIN
  CREATE POLICY billing_walkie_tenant_bindings_service_role ON public.billing_walkie_tenant_bindings
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
