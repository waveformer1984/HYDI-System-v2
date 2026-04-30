-- Add project_name to ledger table for client dashboard filtering
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS project_name TEXT;

-- Index for faster filtering by project
CREATE INDEX IF NOT EXISTS idx_ledger_project_name ON ledger(project_name);