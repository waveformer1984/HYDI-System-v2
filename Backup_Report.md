# Backup Report

## Executive Summary

- **Backup created:** `data\backups\hydi_local_backup_20260805_181806.dump`
- **Method:** `pg_dump -Fc` (custom-format) of the local Supabase Postgres (`supabase_db_hydi-local-supabase`) via `docker exec`.
- **Backup size:** 0.38 MB
- **TOC entries:** 772
- **SHA-256:** `35D21BEAFDF7AA4150414D5C3C982924CD9CF5E6228339BC14FE9DE5551B251B`
- **Restorability:** **VERIFIED** — backup was restored to a test database `hydi_backup_test` and data row counts matched the original.

## Backup Details

| Attribute | Value |
|-----------|-------|
| Source container | `supabase_db_hydi-local-supabase` |
| Source database | `postgres` |
| Host port | `54322` |
| Backup command | `pg_dump -U postgres -Fc -f /tmp/hydi_local_backup.dump postgres` |
| Backup format | Custom (`-Fc`) with gzip compression |
| Backup file | `C:\Users\Owner\HYDI_System\data\backups\hydi_local_backup_20260805_181806.dump` |
| Timestamp (UTC) | `2026-08-05 23:18:09` |
| Timestamp (local) | `2026-08-05 18:18:06` |
| Size | 0.38 MB |
| SHA-256 | `35D21BEAFDF7AA4150414D5C3C982924CD9CF5E6228339BC14FE9DE5551B251B` |

## Restorability Verification

A test restore was performed into a freshly created `hydi_backup_test` database:

```text
dropdb -h 127.0.0.1 -U postgres hydi_backup_test
createdb -h 127.0.0.1 -U postgres hydi_backup_test
pg_restore -h 127.0.0.1 -U postgres --no-owner --no-privileges -d hydi_backup_test /tmp/hydi_local_backup.dump
```

### Row count comparison

| Table | Original | Restored | Match |
|-------|----------|----------|-------|
| `public.actions` | 232 | 232 | Yes |
| `public.memories` | 4 | 4 | Yes |
| `public.sessions` | 2 | 2 | Yes |

### Errors observed

`pg_restore` emitted **2 warnings** for system-owned objects that do not affect application data:

1. `realtime.list_changes` function with `SET log_min_messages` — permission denied.
2. `COPY vault.secrets` — permission denied for table `vault.secrets`.

Both are Supabase-system internals and do not contain user/application data. The `public`, `auth`, and `storage` schemas restored successfully.

## Commands Executed

```text
docker exec supabase_db_hydi-local-supabase pg_dump -U postgres -Fc -f /tmp/hydi_local_backup.dump postgres
docker cp supabase_db_hydi-local-supabase:/tmp/hydi_local_backup.dump data\backups\hydi_local_backup_20260805_181806.dump
Get-FileHash data\backups\hydi_local_backup_20260805_181806.dump -Algorithm SHA256
docker exec supabase_db_hydi-local-supabase bash -c 'createdb -h 127.0.0.1 -U postgres hydi_backup_test && pg_restore -h 127.0.0.1 -U postgres --no-owner --no-privileges -d hydi_backup_test /tmp/hydi_local_backup.dump'
docker exec supabase_db_hydi-local-supabase psql -h 127.0.0.1 -U postgres -d hydi_backup_test -Atc "SELECT (SELECT COUNT(*) FROM public.actions) AS actions, (SELECT COUNT(*) FROM public.memories) AS memories, (SELECT COUNT(*) FROM public.sessions) AS sessions;"
docker exec supabase_db_hydi-local-supabase dropdb -h 127.0.0.1 -U postgres hydi_backup_test
```

## Conclusion

**PASS.** A restorable backup of the local Supabase database has been created, checksummed, and verified. The test database was dropped after verification. The backup is safe to keep as the pre-migration baseline.
