-- Alter ledger table to remove source_account and add stripe_customer_id
ALTER TABLE ledger DROP COLUMN IF EXISTS source_account;
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Add index on stripe_customer_id for faster queries
CREATE INDEX IF NOT EXISTS idx_ledger_stripe_customer ON ledger(stripe_customer_id);