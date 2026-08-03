# Qualification Isolation Plan

**Date:** 2026-08-03
**Scope:** A reversible, non-destructive plan to run only the Docker services required for the HYDI 24-hour qualification.

## Constraints

- No Docker images, volumes, containers, repositories, or configuration files are deleted.
- No services are stopped during the investigation; this is an execution plan only.
- All `stop`/`start` actions are reversible.

## Qualification Profile

The minimal set of Docker services that must be running during qualification is:

### `hydi-local-supabase` — keep these core containers

| Container | Reason |
|-----------|--------|
| `supabase_db_hydi-local-supabase` | Postgres; `api/health` and all data endpoints depend on it |
| `supabase_kong_hydi-local-supabase` | API gateway; routes public and internal Supabase API |
| `supabase_rest_hydi-local-supabase` | PostgREST; `api/health` reads `system_dashboard` view through it |
| `supabase_auth_hydi-local-supabase` | Auth; `api/chat` and other user-aware endpoints need it |
| `supabase_realtime_hydi-local-supabase` | Realtime subscriptions for PAO / worker coordination |
| `supabase_storage_hydi-local-supabase` | Storage; `api/memory` and file attachments may use it |

### `hydi-local-supabase` — stop these non-essential containers

| Container | Reason to stop |
|-----------|----------------|
| `supabase_vector_hydi-local-supabase` | Log shipper; crash-looping; not used by qualification |
| `supabase_edge_runtime_hydi-local-supabase` | Edge Functions runtime; already exited 255 |
| `supabase_inbucket_hydi-local-supabase` | Mail testing UI; not needed |
| `supabase_pg_meta_hydi-local-supabase` | Postgres metadata UI; not needed |
| `supabase_studio_hydi-local-supabase` | Supabase Studio UI; not needed |
| `supabase_analytics_hydi-local-supabase` | Logflare analytics; not needed |

### `ursula_suite` — keep these core services

| Container | Reason |
|-----------|--------|
| `ursula-postgres` | Ursula database for ProtoHub |
| `ursula-redis` | Ursula cache |
| `ursula-hub` | ProtoHub API; `heidi-bridge` depends on `PROTOHUB_URL=http://localhost:4000` |
| `ursula-flask` | Flask backend; `heidi-bridge` depends on `URSULA_URL=http://localhost:5000` |

**Note:** `services-manifest.json` currently starts `ursula-flask` indirectly via `docker-stack` only as `docker compose up postgres redis protohub-api`. `ursula-flask` is not explicitly started, but the bridge environment variables reference `localhost:5000`. The qualification profile must start it.

### `ursula_suite` — do not start these optional services

| Container | Reason |
|-----------|--------|
| `ursula-porchwise-frontend` | PorchWise UI; not in qualification workload |
| `ursula-games-frontend` | Games UI; not in qualification workload |
| `ursula-adminer` | Postgres UI; not in qualification workload |
| `ursula-redis-commander` | Redis UI; not in qualification workload |

### Non-HYDI stacks — stop entirely

| Project | Containers to stop | Reason |
|---------|--------------------|--------|
| `docker` (HYDI-TailNet) | `hydi-api`, `hydi-dashboard`, `hydi-file-sync`, `hydi-loki`, `hydi-monitoring`, `hydi-notifications`, `hydi-redis`, `hydi-remote-commands` (and `hydi-grafana` is already exited) | Not referenced by qualification config or manifest |
| `outputs` | `protoforge-grafana`, `protoforge-prometheus`, `protoforge-redis` (and `protoforge-postgres` already exited) | Not referenced by HYDI qualification |

### Standalone container — do not start

| Container | Action |
|-----------|--------|
| `redis` (no project) | Leave stopped; do not remove unless explicitly approved |

## Reversible Execution Steps

### Pre-qualification (before 24-hour run)

```powershell
# 1. Stop the crash-looping Supabase Vector log shipper
docker stop supabase_vector_hydi-local-supabase

# 2. Stop the non-essential Supabase UI / analytics containers
docker stop supabase_inbucket_hydi-local-supabase
docker stop supabase_pg_meta_hydi-local-supabase
docker stop supabase_studio_hydi-local-supabase
docker stop supabase_analytics_hydi-local-supabase

# 3. Stop the unrelated TailNet stack
docker stop hydi-api hydi-dashboard hydi-file-sync hydi-loki hydi-monitoring hydi-notifications hydi-redis hydi-remote-commands

# 4. Stop the unrelated outputs / protoforge monitoring stack
docker stop protoforge-grafana protoforge-prometheus protoforge-redis

# 5. Ensure the Ursula core services are up, including flask-backend
docker compose -f "C:\ProtoForge_Ecosystem\Ursula_Suite\docker-compose.yml" up -d postgres redis protohub-api flask-backend
```

### Post-qualification (restore environment)

```powershell
# 1. Restart Supabase containers
docker start supabase_vector_hydi-local-supabase
docker start supabase_inbucket_hydi-local-supabase
docker start supabase_pg_meta_hydi-local-supabase
docker start supabase_studio_hydi-local-supabase
docker start supabase_analytics_hydi-local-supabase

# 2. Restart TailNet stack
docker start hydi-api hydi-dashboard hydi-file-sync hydi-loki hydi-monitoring hydi-notifications hydi-redis hydi-remote-commands

# 3. Restart outputs / protoforge monitoring
docker start protoforge-grafana protoforge-prometheus protoforge-redis

# 4. If desired, stop the Ursula flask-backend
docker compose -f "C:\ProtoForge_Ecosystem\Ursula_Suite\docker-compose.yml" stop flask-backend
```

## Risk Notes

- `supabase_vector` is already crash-looping; stopping it will not affect qualification and will reduce CPU churn.
- `hydi-loki` and `protoforge-prometheus/grafana` are observability stacks; stopping them only removes optional telemetry.
- TailNet (`hydi-*`) is a separate product; stopping it does not affect the `localhost:3000` qualification.
- The plan assumes `supabase_db`, `supabase_kong`, `supabase_rest`, `supabase_auth`, `supabase_realtime`, and `supabase_storage` are healthy and must remain running.
- `ursula-flask` may not have been previously running; starting it is required for `heidi-bridge` (`localhost:5050/health`).

## Rollback Safety

- All `docker stop` operations can be reversed with the exact `docker start` command.
- No images or volumes are removed.
- Supabase `restart: unless-stopped` policy means stopped containers will not autostart; they must be explicitly restarted.
