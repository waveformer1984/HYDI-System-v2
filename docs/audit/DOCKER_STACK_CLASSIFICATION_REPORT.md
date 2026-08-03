# Docker Stack Classification Report

**Date:** 2026-08-03
**Scope:** Every running or recently exited Docker Compose project on the host.

## Discovery

```
docker compose ls --all
NAME                STATUS                  CONFIG FILES
docker              exited(1), running(8)   C:\Users\Owner\HYDI-TailNet\docker\docker-compose.windows.yml
outputs             exited(1), running(3)   C:\Users\Owner\AppData\Roaming\Claude\...\outputs\docker-compose-simple.yml
ursula_suite        running(3)              C:\ProtoForge_Ecosystem\Ursula_Suite\docker-compose.yml
```

A fourth effective project was identified by container labels:

```
docker ps -a --format '{{.Names}} {{.Label "com.docker.compose.project"}} {{.Label "com.docker.compose.service"}}'
```

- `hydi-local-supabase` (no `docker compose ls` entry; started by `supabase start` or a non-ls compose command)

## Stack 1 — `hydi-local-supabase`

| Attribute | Evidence |
|-----------|----------|
| **Project purpose** | Local Supabase: PostgreSQL, PostgREST, Auth, Realtime, Storage, Kong gateway, Studio, analytics/mail |
| **Owning repository** | `C:\Users\Owner\HYDI_System` (invoked via `supabase start` in `scripts/start-hydi.js`) |
| **HYDI depends on it?** | Yes. `.ports.json` lists `next-app -> supabase`; `api/health` reads from Supabase `system_dashboard` view |
| **Actively used?** | Yes. 12/13 containers running; Postgres healthy and receiving queries |
| **Can be stopped temporarily?** | No while qualification runs; Supabase DB must stay up |
| **Restart mechanism** | `restart: unless-stopped` in most Supabase containers; Kong/DB/REST/Auth/Storage/Realtime rely on each other |
| **Operational risk if stopped** | `api/health` and `api/chat` would fail immediately |
| **Classification** | **REQUIRED** |

## Stack 2 — `ursula_suite`

| Attribute | Evidence |
|-----------|----------|
| **Project purpose** | ProtoForge/Ursula execution stack: Postgres, Redis, ProtoHub API, Flask backend, optional frontends |
| **Owning repository** | `C:\ProtoForge_Ecosystem\Ursula_Suite` |
| **HYDI depends on it?** | Yes. `services-manifest.json` `docker-stack` command is `docker compose up postgres redis protohub-api`; `heidi-bridge` depends on it |
| **Actively used?** | Partially. Only `ursula-postgres`, `ursula-redis`, `ursula-hub` are running; `ursula-flask`, `porchwise`, `games`, `adminer`, `redis-commander` are not |
| **Can be stopped temporarily?** | `ursula-postgres`, `ursula-redis`, `ursula-hub` should stay up; optional UIs can be stopped if already not started |
| **Restart mechanism** | `restart: unless-stopped` |
| **Operational risk if stopped** | `heidi-bridge` (`localhost:5050/health`) and `supervisor-status` may fail; ProtoHub unhealthy, which already adds risk |
| **Classification** | **REQUIRED** (core trio) / **OPTIONAL** (frontends and admin tools) |

## Stack 3 — `docker` (HYDI-TailNet)

| Attribute | Evidence |
|-----------|----------|
| **Project purpose** | Containerized TailNet edge services: api-gateway, mobile-dashboard, file-sync, remote-commands, monitoring, notifications, redis, grafana, loki |
| **Owning repository** | `C:\Users\Owner\HYDI-TailNet` |
| **HYDI depends on it?** | No. Not referenced in `services-manifest.json`, `supervisor.js`, `start-hydi.js`, `.ports.json`, or `qualification-config.json` |
| **Actively used?** | Yes, 8 containers running, but no inbound qualification traffic |
| **Can be stopped temporarily?** | Yes; the qualification does not use ports 8000, 8501, 2586, 3100, 9090, etc. |
| **Restart mechanism** | `restart: unless-stopped` in compose file |
| **Operational risk if stopped** | Would break TailNet remote access; does not affect `localhost:3000` qualification |
| **Classification** | **UNRELATED** |

## Stack 4 — `outputs`

| Attribute | Evidence |
|-----------|----------|
| **Project purpose** | Prometheus + Grafana + Redis monitoring; config lives in a Claude agent outputs scratch directory |
| **Owning repository** | `C:\Users\Owner\AppData\Roaming\Claude\...\outputs` (not a source repository) |
| **HYDI depends on it?** | No. Not referenced in any HYDI startup or qualification file |
| **Actively used?** | Yes, 3 running; `protoforge-postgres` is exited |
| **Can be stopped temporarily?** | Yes; Prometheus on 9090 and Grafana on 3001 are not used by the qualification |
| **Restart mechanism** | Compose `restart` policy |
| **Operational risk if stopped** | None for HYDI qualification; may break an ad-hoc monitoring dashboard |
| **Classification** | **UNRELATED** |

## Standalone container: `redis`

| Attribute | Evidence |
|-----------|----------|
| **Project purpose** | Unknown; no compose labels, image `redis:latest` |
| **HYDI depends on it?** | No. Not in any manifest or port registry |
| **Actively used?** | Exited 4 weeks ago |
| **Can be stopped?** | Already stopped; should be removed only if confirmed safe |
| **Classification** | **UNKNOWN** (low risk; not running) |

## Summary Table

| Project | Running count | Exited count | Classification | Core services required for qualification |
|---------|---------------|--------------|----------------|------------------------------------------|
| `hydi-local-supabase` | 12 | 1 | REQUIRED | `supabase_db`, `supabase_kong`, `supabase_rest`, plus Auth/Realtime/Storage for full features |
| `ursula_suite` | 3 | 0 | REQUIRED | `ursula-postgres`, `ursula-redis`, `ursula-hub`; `ursula-flask` must also start |
| `docker` (TailNet) | 8 | 1 | UNRELATED | none |
| `outputs` | 3 | 1 | UNRELATED | none |
| `redis` (standalone) | 0 | 1 | UNKNOWN | none |
