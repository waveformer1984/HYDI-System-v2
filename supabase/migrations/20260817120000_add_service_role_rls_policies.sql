-- Migration: 20260817120000_add_service_role_rls_policies
--
-- Problem: Core tables (leads, quotes, checkout_sessions, ledger, etc.) have
-- RLS enabled but no explicit service_role policy AND no DML GRANTs for
-- service_role. In cloud Supabase the service_role bypasses RLS via BYPASSRLS
-- and has broad grants, but local Supabase demo mode only grants
-- TRUNCATE/REFERENCES/TRIGGER to service_role on these tables — missing
-- SELECT/INSERT/UPDATE/DELETE. This caused verify-supabase.sh to warn "RLS
-- blocking service role" on 12 core tables and made the revenue API return
-- 500 on lead/quote inserts.
--
-- Fix: (1) Add explicit `FOR ALL TO service_role` RLS policies (USING true,
-- WITH CHECK true) to every core table that has RLS enabled but no
-- service_role policy. (2) GRANT SELECT/INSERT/UPDATE/DELETE on those tables
-- TO service_role. This matches the pattern already used by heidi_events
-- (migration 20260626130000) and does NOT weaken security: anon/authenticated
-- remain fail-closed because no anon/authenticated policies are added.
--
-- Idempotent: uses DO $$ blocks with exception handling to avoid errors on
-- re-application (CREATE POLICY IF NOT EXISTS is not supported in older
-- Postgres versions used by local Supabase).

-- Revenue pipeline tables: RLS policies + DML grants
DO $$ BEGIN
    CREATE POLICY leads_service_role ON public.leads FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO service_role;

DO $$ BEGIN
    CREATE POLICY outreach_service_role ON public.outreach FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach TO service_role;

DO $$ BEGIN
    CREATE POLICY proposals_service_role ON public.proposals FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposals TO service_role;

DO $$ BEGIN
    CREATE POLICY quotes_service_role ON public.quotes FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes TO service_role;

DO $$ BEGIN
    CREATE POLICY checkout_sessions_service_role ON public.checkout_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkout_sessions TO service_role;

DO $$ BEGIN
    CREATE POLICY product_ideas_service_role ON public.product_ideas FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_ideas TO service_role;

DO $$ BEGIN
    CREATE POLICY product_listings_service_role ON public.product_listings FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_listings TO service_role;

DO $$ BEGIN
    CREATE POLICY task_queue_service_role ON public.task_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_queue TO service_role;

-- Worker tables: RLS policies + DML grants
DO $$ BEGIN
    CREATE POLICY worker_jobs_service_role ON public.worker_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_jobs TO service_role;

DO $$ BEGIN
    CREATE POLICY worker_failures_service_role ON public.worker_failures FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_failures TO service_role;

-- Core HYDI tables (memories, actions, sessions, ledger, clients, payouts,
-- webhook_events — created by earlier migrations with RLS but no service_role
-- policy or DML grants). Guarded by existence check so missing tables or
-- views don't error.
-- Note: `ledger` may be a view; views don't support RLS policies or DELETE,
-- so we filter to base tables only (information_schema.tables.table_type =
-- 'BASE TABLE') and only GRANT SELECT on views.
DO $$
DECLARE
    tbl TEXT;
    is_base BOOLEAN;
    core_tables TEXT[] := ARRAY[
        'memories', 'actions', 'sessions', 'ledger',
        'clients', 'payouts', 'webhook_events'
    ];
BEGIN
    FOREACH tbl IN ARRAY core_tables LOOP
        SELECT (table_type = 'BASE TABLE')
          INTO is_base
          FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = tbl;
        IF is_base THEN
            EXECUTE format(
                'CREATE POLICY %I_service_role ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
                tbl, tbl
            );
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', tbl);
        END IF;
    END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
