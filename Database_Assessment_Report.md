# Database Assessment Report

## Executive Summary

- **Assessed instance:** Local Supabase `supabase_db_hydi-local-supabase` on `127.0.0.1:54322`.
- **Total migration files in `supabase/migrations/`:** 81 (73 active `.sql`, 8 skipped `.sql.skip`).
- **Migration tracking table:** `supabase_migrations.schema_migrations` does **not** exist — the HYDI application migrations have not been applied to this local instance.
- **Existing data:** **232 rows** in `public.actions`, **4 rows** in `public.memories`, **2 rows** in `public.sessions`, **0 rows** in `auth.users`.
- **Production data determination:** The `public.actions` table contains non-trivial data. Per the safety rule, this database is treated as **production until proven otherwise** and must be backed up before any migration.

## Tables Present (Postgres `pg_tables`)

### `public` schema

- `public.actions`
- `public.memories`
- `public.sessions`

### `auth` schema

- `auth.audit_log_entries`
- `auth.custom_oauth_providers`
- `auth.flow_state`
- `auth.identities`
- `auth.instances`
- `auth.mfa_amr_claims`
- `auth.mfa_challenges`
- `auth.mfa_factors`
- `auth.oauth_authorizations`
- `auth.oauth_client_states`
- `auth.oauth_clients`
- `auth.oauth_consents`
- `auth.one_time_tokens`
- `auth.refresh_tokens`
- `auth.saml_providers`
- `auth.saml_relay_states`
- `auth.schema_migrations` (GoTrue internal)
- `auth.sessions`
- `auth.sso_domains`
- `auth.sso_providers`
- `auth.users`
- `auth.webauthn_challenges`
- `auth.webauthn_credentials`

### `storage` schema

- `storage.buckets`
- `storage.buckets_analytics`
- `storage.buckets_vectors`
- `storage.iceberg_namespaces`
- `storage.iceberg_tables`
- `storage.migrations`
- `storage.objects`
- `storage.s3_multipart_uploads`
- `storage.s3_multipart_uploads_parts`
- `storage.vector_indexes`

## Row Counts (exact `COUNT(*)`)

| Schema | Table | Rows |
|--------|-------|------|
| public | actions | 232 |
| public | memories | 4 |
| public | sessions | 2 |
| auth | users | 0 |

All other tables queried returned 0 or `pg_class.reltuples` estimates of -1 (no data or un-analyzed).

## Missing Expected Tables

The following tables expected by the migration suite are **not present** in the `public` schema:

- `heidi_events`
- `pending_tasks`
- `ledger`
- `clients`
- `payouts`
- `notifications`
- `policies`
- `decisions`
- `customers`
- `infrastructure_health`

This confirms the migration set has not been applied.

## Migration File Inventory

| Category | Count |
|----------|-------|
| Total files in `supabase/migrations/` | 81 |
| Active `.sql` migrations | 73 |
| Skipped `.sql.skip` migrations | 8 |

Sample active migrations:

- `001_keymaker_core.sql`
- `003_memory_engine.sql`
- `20260425104500_create_ledger_table.sql`
- `20260425105500_create_clients_table.sql`
- `20260424220000_hdi_chaos_safety_schema.sql`

## Commands Executed

```text
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('public','auth','storage') ORDER BY schemaname,tablename;"
docker exec supabase_db_hydi-local-supabase psql -U postgres -Atc "SELECT (SELECT COUNT(*) FROM public.actions) AS actions, (SELECT COUNT(*) FROM public.memories) AS memories, (SELECT COUNT(*) FROM public.sessions) AS sessions, (SELECT COUNT(*) FROM auth.users) AS users;"
Get-ChildItem supabase\migrations | Measure-Object
```

## Conclusion

**TREAT AS PRODUCTION.** The database is not empty; `public.actions` holds 232 records and there are 4 memories. The HYDI migration set (73 active `.sql` files) has not been applied. Before any `npx supabase migration up` or schema change, a full backup must be created and verified. No destructive commands were run in this phase.
