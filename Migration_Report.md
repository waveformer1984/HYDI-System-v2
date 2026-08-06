# Migration Report

## Executive Summary

- **Migration file inventory:** 81 files in `supabase/migrations/`.
- **Active migrations (`*.sql`):** 73.
- **Skipped migrations (`*.sql.skip`):** 8 (excluded by CLI naming convention).
- **Pre-migration backup:** `data\backups\hydi_local_backup_20260805_181806.dump` (0.38 MB, SHA-256 verified).
- **Migration command:** `npx supabase migration up --local`.
- **Migration result:** **EXIT 0** — all active migrations applied successfully.
- **Post-migration database connection test:** `DB_TEST: true`.

## Migration Status

| Status | Count |
|--------|-------|
| Applied | 73 |
| Skipped | 8 |
| Failed | 0 |
| Pending | 0 |

## Skipped Migrations (`.sql.skip`)

These files are intentionally excluded from the CLI runner because the `.skip` extension does not match the required `<timestamp>_name.sql` pattern:

- `20260424230000_chaos_verdict_views.sql.skip`
- `20260424231000_chaos_alerts_view.sql.skip`
- `20260424232000_chaos_functions_deploy.sql.skip`
- `20260424233000_chaos_functions_fixed.sql.skip`
- `20260426013100_fix_anchor_null_constraint.sql.skip`
- `20260426063839_20260426013300_apply_core_fixes.sql.skip`
- `20260426140100_fix_anchor_null_constraint.sql.skip`
- `20260528000001_enable_rls_unprotected_tables.sql.skip`

## Representative Applied Migrations

- `001_keymaker_core.sql`
- `002_keymaker_functions.sql`
- `003_memory_engine.sql`
- `20260425104500_create_ledger_table.sql`
- `20260425105500_create_clients_table.sql`
- `20260430160000_create_pending_tasks.sql`
- `20260527000001_infrastructure_health_table.sql`
- `20260528000001_enable_rls_unprotected_tables.sql`
- `20260528000002_policies_table.sql`
- `20260714150000_promote_action_type_tiered_policy.sql`

## Notices During Migration

The runner emitted `NOTICE` messages for pre-existing or idempotent objects (e.g., `uuid-ossp` extension, `vector` extension, already-existing `event_bus_events` and `memories` tables). These are non-fatal idempotency guards. No `ERROR` lines were emitted and the command exited with code `0`.

## Post-Migration Database State

`database.testConnection()` reported `Database connection: OK` for `http://127.0.0.1:543...`.

The `public` schema now contains the expected application tables, including:

- `heidi_events`
- `pending_tasks`
- `ledger`
- `clients`
- `payouts`
- `policies`
- `decisions`
- `infrastructure_health`
- `memories`
- `sessions`
- `users`
- `api_keys`

(68 `public` tables total.)

## Commands Executed

```text
npx supabase migration list --local
npx supabase migration up --local
node -e "require('./src/database.js').testConnection().then(r => console.log('DB_TEST:', r));"
```

## Conclusion

**PASS.** All 73 active migrations were applied successfully. The database now has the full HYDI schema, the connection test passes, and no destructive `db reset` was required. The 8 `.sql.skip` files remain intentionally excluded.
