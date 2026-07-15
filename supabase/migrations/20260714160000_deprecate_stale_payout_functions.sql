-- Deprecate process_payout() and generate_monthly_payouts().
--
-- process_payout() (20260425111500_create_process_payout_function.sql) was
-- always a stub: it fabricates a random hex string as `stripe_transfer_id`
-- and marks the payout 'completed' without ever calling Stripe. The real
-- transfer now happens in the stripe-transfer-payout Edge Function, which
-- does call stripe.transfers.create(). Left as-is, process_payout() is a
-- landmine: anything that calls it directly gets a false "completed" payout
-- and zero dollars actually sent.
--
-- generate_monthly_payouts() (20260425111000_create_generate_monthly_payouts_function.sql)
-- references ledger.stripe_customer_id and ledger.timestamp, both of which
-- were removed when 20260425161640_add_stripe_connect_subaccount_support.sql
-- dropped and rebuilt the ledger table with a different schema
-- (created_at/updated_at, no stripe_customer_id). It has errored on every
-- invocation since. Its row-creation role is now covered by the
-- monthly-payout-calculation Edge Function.
--
-- Neither function has a pg_cron schedule or any caller in application code
-- (grep turned up only a standalone dev script, test_payout_flow.js, and
-- each function's own governance-gate test). Replacing both bodies with a
-- RAISE EXCEPTION rather than dropping them outright — fails loud instead of
-- silently faking success or erroring on a missing column, and is safer in
-- case something outside this repo still calls them directly by name.

create or replace function process_payout(p_payout_id uuid)
returns void as $$
begin
    raise exception 'process_payout() is deprecated -- it never called Stripe and only fabricated a fake transfer id. Use the stripe-transfer-payout Edge Function instead.';
end;
$$ language plpgsql;

create or replace function generate_monthly_payouts()
returns void as $$
begin
    raise exception 'generate_monthly_payouts() is deprecated -- it references ledger columns removed by 20260425161640_add_stripe_connect_subaccount_support.sql. Use the monthly-payout-calculation Edge Function instead.';
end;
$$ language plpgsql;
