# Local Database Inventory

## Docker Stack

Local project: `HYDI-System-v2`

| Container | Status | Ports | Notes |
|---|---|---|---|
| `supabase_kong_HYDI-System-v2` | Up (healthy) | `0.0.0.0:54321->8000` | Main API gateway / REST endpoint |
| `supabase_db_HYDI-System-v2` | Up (healthy) | `0.0.0.0:54322->5432` | PostgreSQL 15 |
| `supabase_auth_HYDI-System-v2` | Up (healthy) | `9999` | Supabase Auth |
| `supabase_rest_HYDI-System-v2` | Up | `3000` | PostgREST |
| `supabase_realtime_HYDI-System-v2` | Up (healthy) | `4000` | Realtime |
| `supabase_storage_HYDI-System-v2` | Up (healthy) | `5000` | Storage |
| `supabase_inbucket_HYDI-System-v2` | Up (healthy) | `1025, 1110, 0.0.0.0:54324->8025` | Email testing |
| `supabase_analytics_HYDI-System-v2` | Up (healthy) | `0.0.0.0:54327->4000` | Analytics/Logflare |
| `supabase_edge_runtime_HYDI-System-v2` | Up | — | Edge Functions |
| `supabase_pg_meta_HYDI-System-v2` | Up (healthy) | `8080` | Postgres Meta |
| `supabase_studio_HYDI-System-v2` | Up (healthy) | `0.0.0.0:54323->3000` | Supabase Studio UI |
| `supabase_vector_HYDI-System-v2` | Up | — | Vector/Logflare ingestion |

## Volumes

| Volume | Driver | Scope | Mountpoint | Purpose |
|---|---|---|---|---|
| `supabase_db_HYDI-System-v2` | local | local | `/var/lib/docker/volumes/supabase_db_HYDI-System-v2/_data` | PostgreSQL persistent data |
| `supabase_storage_HYDI-System-v2` | local | local | — | Storage objects |
| `supabase_edge_runtime_HYDI-System-v2` | local | local | — | Edge Function state |
| `ursula_suite_postgres_data` | local | local | — | Ursula Postgres |
| `ursula_suite_redis_data` | local | local | — | Ursula Redis |

The canonical HYDI database volume is `supabase_db_HYDI-System-v2`.

## Database

- Host: `localhost`
- PostgreSQL port: `54322`
- API (Kong) port: `54321`
- User: `supabase_admin`
- Database: `postgres`
- Database size: ~34 MB
- Schema: `public` plus Supabase system schemas (`auth`, `storage`, `supabase_functions`, `vault`, ...)

## Public Tables

The `public` schema contains **106 tables**, including:

Core operational:
- `heidi_events`
- `heidi_reflections`
- `heidi_decision_bounds`
- `heidi_metrics_snapshots`
- `heidi_procedural_lessons`
- `heidi_telemetry`
- `raw_event_ledger`
- `decisions`
- `policies`
- `worker_jobs`
- `worker_queues`
- `task_queue`
- `work_sessions`
- `pending_tasks`

Status / health:
- `system_dashboard` (view)
- `system_health_runs`
- `infrastructure_health`

Revenue / billing:
- `financial_ledger`
- `payouts`
- `checkout_sessions`
- `customers`
- `quotes`
- `proposals`
- `offers`

Chat / memory:
- `chat_conversations`
- `chat_messages`
- `memories`
- `knowledge_documents`
- `semantic_chunks`

Rezonate:
- `rezonate_audio_files`
- `rezonate_patterns`
- `rezonate_projects`
- `rezonate_tracks`

(HYDI project/track tables in this local schema are `rezonate_projects` and `rezonate_tracks`.)

## Migration State

Local migrations are stored in `supabase_migrations` schema. `supabase/migrations/` contains the canonical source. The local database was not reset; all current data is retained.

## Project/Track Tables

For the local-first persistence acceptance scenario, the relevant project/track tables are:

- `rezonate_projects`
- `rezonate_tracks`

## Health

- `supabase_db` container: `healthy`
- `supabase_kong` container: `healthy`
- REST API (`/rest/v1/system_dashboard?limit=1`) returns 200 with valid payload.
- PostgreSQL accepts connections from `supabase_admin`.
