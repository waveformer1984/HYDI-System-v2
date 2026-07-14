-- ============================================
-- BILLING ENGINE STATS RPC
-- Backs supabase/functions/billing-engine's GET endpoint with real
-- aggregates from the ledger table, replacing the hardcoded mock response
-- (pendingInvoices: 12, totalBilled: 28500, ...) the function shipped with.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_billing_engine_stats()
RETURNS TABLE (
  pending_count bigint,
  completed_today_count bigint,
  failed_today_count bigint,
  total_gross_completed numeric,
  total_net_completed numeric,
  success_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH totals AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'completed' AND created_at >= date_trunc('day', now())) AS completed_today,
      COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= date_trunc('day', now())) AS failed_today,
      COALESCE(SUM(amount_gross) FILTER (WHERE status = 'completed'), 0) AS gross,
      COALESCE(SUM(net_amount) FILTER (WHERE status = 'completed'), 0) AS net,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed_all,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_all
    FROM public.ledger
  )
  SELECT
    totals.pending,
    totals.completed_today,
    totals.failed_today,
    totals.gross,
    totals.net,
    CASE
      WHEN (totals.completed_all + totals.failed_all) = 0 THEN 100.0
      ELSE ROUND(100.0 * totals.completed_all / (totals.completed_all + totals.failed_all), 2)
    END
  FROM totals;
END;
$$;

REVOKE ALL ON FUNCTION public.get_billing_engine_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_billing_engine_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_billing_engine_stats() TO authenticated;
