# Database Report

## Executive Summary

- **Instance:** Local Supabase `supabase_db_hydi-local-supabase` (`127.0.0.1:54322`).
- **Migrations:** 73 active `.sql` migrations applied, 8 `.sql.skip` excluded.
- **Tables:** 68 in `public` schema.
- **Tracked data:** 232 `actions`, 4 `memories`, 2 `sessions`.
- **Backup:** 0.38 MB verified dump at `data\backups\hydi_local_backup_20260805_181806.dump`.
- **Connection:** `database.testConnection()` returns `OK`.

## Migration History

| Category | Count |
|----------|-------|
| Total migration files | 81 |
| Active `.sql` | 73 |
| Skipped `.sql.skip` | 8 |
| Failed | 0 |
| Pending | 0 |

All active migrations were applied with `npx supabase migration up --local` (EXIT 0).

## Schema Snapshot

| Object | Count |
|--------|-------|
| `public` tables | 68 |
| Indexes | 227 |
| Constraints | 170 |
| RLS policies | 107 |
| Triggers | 129 |
| Functions | 175 |
| Views | 8 |

## Core Tables Present

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

## Row Counts

| Table | Rows |
|-------|------|
| `public.actions` | 232 |
| `public.memories` | 4 |
| `public.sessions` | 2 |
| `auth.users` | 0 |

## Backup Status

- **File:** `data\backups\hydi_local_backup_20260805_181806.dump`
- **Size:** 0.38 MB
- **SHA-256:** `35D21BEAFDF7AA4150414D5C3C982924CD9CF5E6228339BC14FE9DE5551B251B`
- **Restorability:** Verified — restored to `hydi_backup_test`, row counts matched.

## Commands Executed

```text
npx supabase migration list --local
npx supabase migration up --local
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "SELECT (SELECT COUNT(*) FROM public.actions), ..."
```

## Conclusion

**PASS.** The local database is migrated, backed up, and healthy. No destructive operations were performed. Data is preserved.
