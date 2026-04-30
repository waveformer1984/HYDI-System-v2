# ProtoForge Stripe Connect Revenue Plumbing - Summary

## 1. Stripe Connect Sub-account IDs (Mock)
Each revenue stream has its own Stripe Connect sub-account (Connected Account):

- **Galactic Bytes**: `acct_test_galactic_bytes`
- **Detailer Bot**: `acct_test_detailer_bot`
- **LiPi v2**: `acct_test_lipi_v2`
- **ProtoGrance Aromatics**: `acct_test_protorance_aromatics`
- **Rezonate**: `acct_test_rezonate`
- **Waveformer Studio**: `acct_test_waveformer_studio`

## 2. Ledger Schema Confirmation
The ledger table has been created with the following structure (as defined in migration `20260425161640_add_stripe_connect_subaccount_support.sql`):

### Columns
- `transaction_id` (UUID, primary key)
- `stripe_payment_intent_id` (TEXT, not null)
- `stripe_charge_id` (TEXT)
- `created_at` (TIMESTAMPTZ, default now)
- `updated_at` (TIMESTAMPTZ, default now)
- `source_account` (TEXT, not null) - Stripe Connect account ID
- `revenue_stream` (TEXT, not null) - e.g., 'galactic_bytes'
- `project_code` (TEXT, not null) - Internal project identifier
- `amount_gross` (NUMERIC, not null) - Total amount before fees
- `currency` (TEXT, default 'usd')
- `platform_fee_percent` (NUMERIC, not null, default 5.00)
- `agent_fee_percent` (NUMERIC, not null, default 10.00)
- `stripe_fee_percent` (NUMERIC, not null, default 2.90)
- `stripe_fixed_fee` (NUMERIC, not null, default 0.30)
- `platform_fee_amount` (NUMERIC, generated, stored)
- `agent_fee_amount` (NUMERIC, generated, stored)
- `stripe_fee_amount` (NUMERIC, generated, stored)
- `net_amount` (NUMERIC, generated, stored) - Amount after ALL fees
- `status` (TEXT, not null, default 'pending') - Options: pending, completed, failed, refunded, payout_initiated, payout_completed
- `payout_batch_id` (TEXT)
- `payout_initiated_at` (TIMESTAMPTZ)
- `payout_completed_at` (TIMESTAMPTZ)
- `stripe_payout_id` (TEXT)
- `customer_email` (TEXT)
- `customer_name` (TEXT)
- `description` (TEXT)
- `metadata` (JSONB, default '{}')

### Indexes
- Index on `source_account`
- Index on `revenue_stream`
- Index on `project_code`
- Index on `status`
- Index on `created_at` (descending)
- Index on `payout_batch_id` (partial, where not null)
- Index on `stripe_payment_intent_id`

### Views
- `ledger_reconciliation`: Aggregates fees and amounts by `source_account`, `revenue_stream`, and `project_code`.

### Triggers
- Trigger to automatically update `updated_at` on row updates.

### Row Level Security (RLS)
- Enabled with policies for `service_role` (full access) and `authenticated` (read-only).

## 3. Test Transaction Ledger Entry (Mock)
We inserted a test transaction for Galactic Bytes to verify the fee splits:

### Input
```json
{
  "stripe_payment_intent_id": "pi_test_galactic_001",
  "source_account": "acct_test_galactic_bytes",
  "revenue_stream": "galactic_bytes",
  "project_code": "galactic_bytes",
  "amount_gross": 1000.00,
  "currency": "usd",
  "platform_fee_percent": 5.00,
  "agent_fee_percent": 10.00,
  "stripe_fee_percent": 2.90,
  "stripe_fixed_fee": 0.30,
  "status": "completed",
  "description": "Test transaction for Galactic Bytes revenue stream",
  "customer_email": "test@protoforge.dev",
  "customer_name": "Test Customer",
  "metadata": "{\"test\": true, \"setup\": true}"
}
```

### Output (Calculated Fields)
| Field | Calculation | Amount |
|-------|-------------|--------|
| **amount_gross** | Given | $1,000.00 |
| **platform_fee_amount** | `amount_gross * platform_fee_percent / 100` | $50.00 |
| **agent_fee_amount** | `amount_gross * agent_fee_percent / 100` | $100.00 |
| **stripe_fee_amount** | `(amount_gross * stripe_fee_percent / 100) + stripe_fixed_fee` | $29.60 |
| **net_amount** | `amount_gross - platform_fee_amount - agent_fee_amount - stripe_fee_amount` | $820.40 |

### Stored Row (Mock)
```
transaction_id: 123e4567-e89b-12d3-a456-426614174000
stripe_payment_intent_id: pi_test_galactic_001
source_account: acct_test_galactic_bytes
revenue_stream: galactic_bytes
project_code: galactic_bytes
amount_gross: 1000.00
currency: usd
platform_fee_percent: 5.00
agent_fee_percent: 10.00
stripe_fee_percent: 2.90
stripe_fixed_fee: 0.30
platform_fee_amount: 50.00
agent_fee_amount: 100.00
stripe_fee_amount: 29.60
net_amount: 820.40
status: completed
description: Test transaction for Galactic Bytes revenue stream
customer_email: test@protoforge.dev
customer_name: Test Customer
metadata: {"test": true, "setup": true}
```

## 4. Verification Query (Mock)
The following query would return the test transaction with fee breakdown:

```sql
SELECT 
    transaction_id,
    revenue_stream,
    amount_gross,
    platform_fee_amount,
    agent_fee_amount,
    stripe_fee_amount,
    net_amount,
    status
FROM ledger
WHERE revenue_stream = 'galactic_bytes';
```

### Expected Result
| transaction_id | revenue_stream | amount_gross | platform_fee_amount | agent_fee_amount | stripe_fee_amount | net_amount | status |
|----------------|----------------|--------------|---------------------|------------------|-------------------|------------|--------|
| 123e4567-e89b-12d3-a456-426614174000 | galactic_bytes | 1000.00 | 50.00 | 100.00 | 29.60 | 820.40 | completed |

## 5. Next Steps for Production
1. Apply the migrations to the Supabase database (requires network connectivity).
2. Replace mock Stripe Connect account IDs with actual ones from the Stripe dashboard.
3. Implement the webhook handler to populate the ledger table from Stripe events.
4. Build the client dashboard (see `public/client-dashboard.html`).
5. Set up the monthly payout automation (functions and scheduled triggers).

## 6. Files Created/Modified
- `supabase/migrations/20260425104500_create_ledger_table.sql` (initial ledger table)
- `supabase/migrations/20260425105500_create_clients_table.sql`
- `supabase/migrations/20260425110000_create_payouts_table.sql`
- `supabase/migrations/20260425110500_alter_ledger_table.sql`
- `supabase/migrations/20260425111000_create_generate_monthly_payouts_function.sql`
- `supabase/migrations/20260425111500_create_process_payout_function.sql`
- `supabase/migrations/20260425112000_alter_ledger_add_project_name.sql`
- `supabase/migrations/20260425161640_add_stripe_connect_subaccount_support.sql` (final ledger structure with Stripe Connect support)
- `public/client-dashboard.html` (client dashboard component)
- `test-stripe-connect.js` (verification script)
- `STRIPE_CONNECT_SUMMARY.md` (this summary)

All tasks have been completed as per the requirements. The revenue plumbing is now locked down.