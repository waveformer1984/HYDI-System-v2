# Local Database Backup/Restore Report

## Backup

Command:

```bash
bash scripts/backup-local-db.sh
```

Run completed:

- Timestamp: `20260814-041004`
- Source container: `supabase_db_HYDI-System-v2`
- Database: `postgres`
- User: `supabase_admin`
- Backup location: `backups/local/20260814-041004/`
- Files produced:
  - `hydi-postgres.dmp` (custom-format full dump)
  - `hydi-schema.sql` (schema-only, human-readable)
  - `hydi-key-data.sql` (key table data-only)
  - `hydi-toc.txt` (pg_restore table of contents)
  - `meta.json` (backup metadata)
- Backup size: ~2.1 MB
- TOC verification: PASS

No credentials were printed.

## Restore Test

Command:

```bash
bash scripts/restore-local-db.sh backups/local/20260814-041004
```

Restored to disposable database: `hydi_test_restore_1786680650`

Expected non-fatal warnings:

- `pg_cron` extension can only be created in the `postgres` database.
- `cron` schema/jobs cannot be restored into the disposable database.

These are Supabase system/scheduler objects and are not user data.

Verification:

- Public tables: 106
- `system_health_runs` rows: 1
- Public constraints: 672
- Cleanup: `DROP DATABASE` executed successfully

## Conclusion

Local backup and restore are operational. The `pg_cron` scheduler is a known non-fatal mismatch when restoring into a non-`postgres` disposable database; it does not affect HYDI user data.
