-- ============================================
-- Phase 5: Financial Ledger separation
-- Rename the financial ledger table to financial_ledger and provide a
-- read-only compatibility view named `ledger`. All writers should target
-- `financial_ledger` directly; the view exists only for a graceful transition.
-- ============================================

DO $$
DECLARE
    v_ledger_relkind char;
BEGIN
    SELECT relkind INTO v_ledger_relkind
    FROM pg_class
    WHERE oid = to_regclass('public.ledger');

    -- If ledger does not exist, nothing to do.
    IF v_ledger_relkind IS NULL THEN
        RETURN;
    END IF;

    -- If ledger is already a view, the rename already happened.
    IF v_ledger_relkind = 'v' THEN
        RETURN;
    END IF;

    -- Rename the table. Dependent objects (views, functions, triggers, policies)
    -- follow by OID and continue to work.
    ALTER TABLE public.ledger RENAME TO financial_ledger;
END $$;

-- Rename indexes to reflect the new table name for clarity.
DO $$
DECLARE
    v_index record;
BEGIN
    FOR v_index IN
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'financial_ledger'
          AND indexname LIKE 'idx_ledger_%'
    LOOP
        EXECUTE format(
            'ALTER INDEX IF EXISTS %I RENAME TO %I',
            v_index.indexname,
            replace(v_index.indexname, 'idx_ledger_', 'idx_financial_ledger_')
        );
    END LOOP;
END $$;

-- Rename trigger and function for consistency (use dynamic SQL so missing objects do not fail parse).
DO $$
BEGIN
    IF to_regclass('public.financial_ledger') IS NOT NULL
       AND to_regprocedure('public.update_ledger_updated_at()') IS NOT NULL THEN
        EXECUTE 'ALTER FUNCTION public.update_ledger_updated_at() RENAME TO update_financial_ledger_updated_at';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        WHERE c.relname = 'financial_ledger'
          AND t.tgname = 'trigger_update_ledger_timestamp'
    ) THEN
        EXECUTE 'ALTER TRIGGER trigger_update_ledger_timestamp ON public.financial_ledger RENAME TO trigger_update_financial_ledger_timestamp';
    END IF;
END $$;

-- Create the read-only compatibility view if it does not already exist.
DO $$
BEGIN
    IF to_regclass('public.ledger') IS NULL
       AND to_regclass('public.financial_ledger') IS NOT NULL THEN
        EXECUTE 'CREATE VIEW public.ledger WITH (security_invoker = on) AS SELECT * FROM public.financial_ledger';
    END IF;
END $$;

-- Recreate the reconciliation view so its text references the new table name.
CREATE OR REPLACE VIEW public.ledger_reconciliation AS
SELECT
    source_account,
    revenue_stream,
    project_code,
    COUNT(*) AS transaction_count,
    SUM(amount_gross) AS total_gross,
    SUM(platform_fee_amount) AS total_platform_fees,
    SUM(agent_fee_amount) AS total_agent_fees,
    SUM(stripe_fee_amount) AS total_stripe_fees,
    SUM(net_amount) AS total_net,
    SUM(CASE WHEN status = 'payout_completed' THEN net_amount ELSE 0 END) AS total_paid_out,
    SUM(CASE WHEN status IN ('pending', 'completed') THEN net_amount ELSE 0 END) AS available_for_payout
FROM public.financial_ledger
GROUP BY source_account, revenue_stream, project_code;

-- Recreate the monthly payout function against financial_ledger, fixing the
-- stale `timestamp` column reference to `created_at` while preserving logic.
CREATE OR REPLACE FUNCTION public.generate_monthly_payouts()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_stripe_customer_id text;
    v_client_id uuid;
    v_client_email text;
    v_client_name text;
    v_gross numeric;
    v_platform_fee numeric;
    v_agent_fee numeric;
    v_net numeric;
    v_period_start date;
    v_period_end date;
    v_payout_id uuid;
BEGIN
    v_period_start := date_trunc('month', current_date) - interval '1 month';
    v_period_end := date_trunc('month', current_date) - interval '1 day';

    FOR v_stripe_customer_id IN
        SELECT DISTINCT stripe_customer_id
        FROM public.financial_ledger
        WHERE created_at >= v_period_start
          AND created_at < v_period_end + interval '1 day'
          AND stripe_customer_id IS NOT NULL
    LOOP
        SELECT client_id, email, client_name
        INTO v_client_id, v_client_email, v_client_name
        FROM public.clients
        WHERE stripe_customer_id = v_stripe_customer_id;

        IF v_client_id IS NULL THEN
            RAISE NOTICE 'Client not found for stripe_customer_id: %', v_stripe_customer_id;
            CONTINUE;
        END IF;

        SELECT COALESCE(SUM(amount_gross), 0),
               COALESCE(SUM(platform_fee_amount), 0),
               COALESCE(SUM(agent_fee_amount), 0)
        INTO v_gross, v_platform_fee, v_agent_fee
        FROM public.financial_ledger
        WHERE stripe_customer_id = v_stripe_customer_id
          AND created_at >= v_period_start
          AND created_at < v_period_end + interval '1 day';

        v_net := v_gross - v_platform_fee - v_agent_fee;

        INSERT INTO public.payouts (
            client_id,
            period_start,
            period_end,
            gross_earnings,
            platform_fee_amount,
            agent_fee_amount,
            net_payout_amount,
            status
        ) VALUES (
            v_client_id,
            v_period_start,
            v_period_end,
            v_gross,
            v_platform_fee,
            v_agent_fee,
            v_net,
            'pending'
        )
        RETURNING payout_id INTO v_payout_id;

        RAISE NOTICE 'Created payout % for client % (%): gross=%, platform_fee=%, agent_fee=%, net=%',
            v_payout_id, v_client_name, v_client_email,
            v_gross, v_platform_fee, v_agent_fee, v_net;
    END LOOP;
END;
$$;
