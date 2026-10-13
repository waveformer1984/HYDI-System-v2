-- ============================================================================
-- Enable RLS on the pre-governance revenue tables: clients, payouts,
-- financial_ledger (renamed from `ledger` in 20260723000001).
--
-- These three tables predate the "RLS on all public tables" rule and never
-- had it enabled. The governance gate's Verify Supabase Schema check surfaced
-- the gap. Access model matches every other backend table: server code uses
-- the service role, so the policies are service_role-only; anon/authenticated
-- direct access is denied, which is the intended trust boundary.
--
-- Idempotent: to_regclass guards cover environments where a table is absent
-- (e.g. a database that predates the ledger rename still has `ledger` — that
-- name is also hardened here for safety).
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients', 'payouts', 'financial_ledger', 'ledger']
  LOOP
    -- `ledger` is a VIEW in databases that applied the rename; ALTER TABLE on
    -- a view fails, so only touch real base tables.
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
       )
    THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I TO service_role USING (true) WITH CHECK (true)',
        t || '_service_role', t
      );
    END IF;
  END LOOP;
END $$;
