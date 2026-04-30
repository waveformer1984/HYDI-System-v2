-- Check current account mapping status
select revenue_stream, account_id, onboarding_status, default_platform_fee_percent, default_agent_fee_percent
from public.stripe_connect_accounts
order by revenue_stream;

-- Check protoforge_ledger schema
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='protoforge_ledger'
order by ordinal_position;

-- Check reconciliation view
select * from public.v_stripe_connect_reconciliation 
order by source_account nulls last, payout_batch_id 
limit 20;
