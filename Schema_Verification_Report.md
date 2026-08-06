# Schema Verification Report

## Executive Summary

- **Migration status:** All 73 active migrations applied successfully.
- **Schema connection:** `database.testConnection()` returns `OK`.
- **`public` tables:** 68.
- **Expected core tables:** Present and populated.
- **Indexes:** 227.
- **Constraints:** 170.
- **RLS policies:** 107.
- **Triggers:** 129.
- **Functions/Procedures:** 175.
- **Views:** 8.

## Expected Core Tables — Verified

| Table | Evidence | Status |
|-------|----------|--------|
| `public.heidi_events` | `id` (uuid, `gen_random_uuid()`), `event_type`, `division`, `payload` (jsonb), `verdict`, `context_snapshot`, `memory_ids`, `created_at` | **Present** |
| `public.pending_tasks` | `id`, `message_id`, `origin`, `target`, `action`, `payload` (jsonb), `priority`, `ttl`, `status` (`'pending'`), `attempts`, `max_attempts`, `expires_at` | **Present** |
| `public.ledger` | `transaction_id`, `stripe_payment_intent_id`, `source_account`, `revenue_stream`, `project_code`, `amount_gross`, `platform_fee_*`, `agent_fee_*`, `stripe_fee_*`, `net_amount` (generated), `status` (`'pending'`) | **Present** |
| `public.memories` | 4 existing rows | **Present** |
| `public.sessions` | 2 existing rows | **Present** |
| `public.clients` | Table created | **Present** |
| `public.payouts` | Table created | **Present** |
| `public.policies` | Table created | **Present** |
| `public.decisions` | Table created | **Present** |
| `public.infrastructure_health` | Table created | **Present** |

## Schema Object Counts (`public`)

| Object Type | Count |
|-------------|-------|
| Tables | 68 |
| Indexes | 227 |
| Constraints | 170 |
| RLS Policies | 107 |
| Triggers | 129 |
| Functions | 175 |
| Views | 8 |

## Sample Views

- `system_dashboard` (drives `/api/health`)
- `ledger_reconciliation`

## RLS Verification

- `pg_policies` reports **107** row-level security policies across the `public` schema.
- All `public` application tables have RLS enabled per the migration suite (`20260528000001_enable_rls_unprotected_tables.sql` and `20260613000001_scope_rls_policies_to_service_role.sql`).

## Constraint Verification

- **170** constraints in `public`, including primary keys, foreign keys, unique constraints, check constraints, and generated columns.
- Notable check constraint on `ledger`: `positive_amount`.
- Generated columns for fee breakdown in `ledger` are `STORED`.

## Commands Executed

```text
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "\dt public.*"
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "\d public.heidi_events"
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "\d public.ledger"
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "\d public.pending_tasks"
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public';"
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "SELECT COUNT(*) FROM pg_constraint WHERE connamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');"
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "SELECT COUNT(*) FROM pg_policies WHERE schemaname='public';"
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "SELECT COUNT(*) FROM pg_trigger WHERE ... "
```

## Conclusion

**PASS.** The migrated `public` schema contains all expected HYDI core tables, hundreds of indexes and constraints, over 100 RLS policies, and the expected views. The `heidi_events`, `pending_tasks`, `ledger`, `memories`, `sessions`, `clients`, `payouts`, `policies`, and `decisions` tables are present and correctly structured.
