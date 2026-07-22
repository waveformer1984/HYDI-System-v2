-- Rollback for 20260723000001_financial_ledger_rename.sql
-- Restores the original ledger table name and drops the compatibility view.

DO $$
BEGIN
    -- Drop the compatibility view if it exists.
    IF to_regclass('public.ledger') IS NOT NULL THEN
        EXECUTE 'DROP VIEW IF EXISTS public.ledger';
    END IF;
END $$;

-- Restore the original reconciliation view text.
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
FROM public.ledger
GROUP BY source_account, revenue_stream, project_code;

DO $$
BEGIN
    IF to_regclass('public.financial_ledger') IS NOT NULL THEN
        -- Rename table back to ledger.
        ALTER TABLE public.financial_ledger RENAME TO ledger;

        -- Rename indexes back.
        EXECUTE 'DO $inner$
        DECLARE
            v_index record;
        BEGIN
            FOR v_index IN
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = ''public''
                  AND tablename = ''ledger''
                  AND indexname LIKE ''idx_financial_ledger_%''
            LOOP
                EXECUTE format(
                    ''ALTER INDEX IF EXISTS %I RENAME TO %I'',
                    v_index.indexname,
                    replace(v_index.indexname, ''idx_financial_ledger_'', ''idx_ledger_'')
                );
            END LOOP;
        END $inner$;';

        -- Rename function and trigger back.
        IF to_regprocedure('public.update_financial_ledger_updated_at()') IS NOT NULL THEN
            EXECUTE 'ALTER FUNCTION public.update_financial_ledger_updated_at() RENAME TO update_ledger_updated_at';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_trigger t
            JOIN pg_class c ON t.tgrelid = c.oid
            WHERE c.relname = 'ledger'
              AND t.tgname = 'trigger_update_financial_ledger_timestamp'
        ) THEN
            EXECUTE 'ALTER TRIGGER trigger_update_financial_ledger_timestamp ON public.ledger RENAME TO trigger_update_ledger_timestamp';
        END IF;
    END IF;
END $$;
