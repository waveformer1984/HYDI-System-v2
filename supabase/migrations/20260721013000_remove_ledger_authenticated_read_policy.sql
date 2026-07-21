-- SECURITY FIX: 20260425161640_add_stripe_connect_subaccount_support.sql created
-- an "Authenticated users read-only" RLS policy on `ledger` (USING (true), no
-- scoping) -- granting every Supabase `authenticated`-role caller full read
-- access to every client's/project's complete financial ledger (gross amounts,
-- fee breakdown, net amounts, customer_email/customer_name, payout status).
--
-- `ledger` has no user_id/client_id/owner column at all, so there is no
-- per-row identity to scope this policy by. Every confirmed-live route that
-- legitimately reads this table (`pages/api/client-dashboard.js`,
-- `pages/api/revenue/*.js`, the payout/reconciliation functions) already uses
-- the service-role key server-side, which bypasses RLS entirely -- meaning
-- this policy serves no real product function today and exists purely as an
-- open door for any Supabase Auth `authenticated` session to read every
-- client's raw financial data directly via PostgREST/the client SDK.
--
-- Matches the fail-closed posture already applied elsewhere in this audit
-- trail (e.g. 20260426121400_fix_rls_policies.sql): the service-role policy
-- is untouched, so nothing server-side is affected.

DROP POLICY IF EXISTS "Authenticated users read-only" ON ledger;
