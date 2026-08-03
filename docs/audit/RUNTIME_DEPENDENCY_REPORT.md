# Runtime Dependency Report

**Date:** 2026-08-03
**Host:** `C:\Users\Owner\HYDI_System`
**Scope:** Identify every service required for the HYDI 24-hour operational qualification.

## Method

Dependency evidence was gathered from the following sources, not from assumptions:

- `C:\Users\Owner\HYDI_System\services-manifest.json`
- `C:\Users\Owner\HYDI_System\supervisor.js`
- `C:\Users\Owner\HYDI_System\scripts\start-hydi.js`
- `C:\Users\Owner\HYDI_System\.ports.json`
- `C:\Users\Owner\HYDI_System\operational-qualification\config\qualification-config.json`
- `C:\ProtoForge_Ecosystem\Ursula_Suite\docker-compose.yml`
- `C:\Users\Owner\HYDI-TailNet\docker\docker-compose.windows.yml`
- `C:\Users\Owner\protoforgesite\docker-compose.hydi.yml`
- Current `docker compose ls` and `docker ps -a` output

## HYDI Workloads Requiring Services

The operational qualification (`operational-qualification/operational-qualification.js`) exercises these endpoints:

| Workload | Endpoint | HYDI Service / Docker Dependency |
|----------|----------|----------------------------------|
| `conversation` | `http://localhost:3000/api/chat` | `next-app` (Next.js, port 3000) |
| `memory-storage` | `http://localhost:3000/api/memory` | `next-app` |
| `memory-retrieval` | `http://localhost:3000/api/memory/search` | `next-app` |
| `supervisor-status` | `http://localhost:9999/status` | `supervisor.js` (Node process) |
| `bridge-request` | `http://localhost:5050/health` | `heidi-bridge` (Flask/Python) |
| `database-operation` | `http://localhost:3000/api/health` | `next-app` + Supabase Postgres |

## Service Manifest

`services-manifest.json` declares the following services (in dependency order):

| Service | Port | Required? | Health check | Dependencies |
|---------|------|-----------|--------------|--------------|
| `memory-engine` | 9998 | true | `http://localhost:9998/health` | none |
| `hydi-core` | 9997 | true | `http://localhost:9997/health` | `memory-engine` |
| `docker-stack` (Ursula) | 4000 | false | `http://localhost:4000/health` | none |
| `heidi-bridge` | 5050 | true | `http://localhost:5050/health` | `docker-stack` |
| `next-app` | 3000 | true | `http://localhost:3000/api/health` | `docker-stack` |
| `heidi-mobile` | 3006 | false | `http://localhost:3006/api/health` | none |
| `forge-loop` | none | false | none | `heidi-bridge` |

The manifest command for `docker-stack` is:

```bash
cd C:\ProtoForge_Ecosystem\Ursula_Suite && docker compose up postgres redis protohub-api
```

## Dependency Graph

```
HYDI Qualification
├── next-app (port 3000) ──── docker-stack (Ursula)
│   └── postgres (5432)
│   └── redis (6379)
│   └── protohub-api (4000)
├── heidi-bridge (port 5050) ──── docker-stack (Ursula)
│   └── protohub-api (4000)
│   └── flask-backend (5000)  ← NOT listed in manifest command; required by bridge env
├── hydi-core (port 9997) ──── memory-engine (port 9998)
├── memory-engine (port 9998)
└── supervisor (port 9999)
```

## Docker Services Required for Qualification

| Container | Project | Service | Port | Status | Classification |
|-----------|---------|---------|------|--------|----------------|
| `supabase_db_hydi-local-supabase` | `hydi-local-supabase` | `db` | 54322 | running healthy | REQUIRED (Postgres for `api/health`) |
| `supabase_kong_hydi-local-supabase` | `hydi-local-supabase` | `kong` | 54321 | running healthy | REQUIRED (API gateway / proxy) |
| `supabase_rest_hydi-local-supabase` | `hydi-local-supabase` | `rest` | 3000 internal | running | REQUIRED (PostgREST) |
| `supabase_auth_hydi-local-supabase` | `hydi-local-supabase` | `auth` | 9999 internal | running healthy | OPTIONAL (auth) |
| `supabase_realtime_hydi-local-supabase` | `hydi-local-supabase` | `realtime` | 4000 internal | running healthy | OPTIONAL (Realtime) |
| `supabase_storage_hydi-local-supabase` | `hydi-local-supabase` | `storage` | 5000 internal | running healthy | OPTIONAL (Storage) |
| `supabase_analytics_hydi-local-supabase` | `hydi-local-supabase` | `analytics` | 4000 internal | running healthy | OPTIONAL (Analytics/logflare) |
| `supabase_pg_meta_hydi-local-supabase` | `hydi-local-supabase` | `pg-meta` | 8080 internal | running healthy | OPTIONAL (Postgres metadata UI) |
| `supabase_inbucket_hydi-local-supabase` | `hydi-local-supabase` | `inbucket` | 54324 | running healthy | OPTIONAL (Mail testing) |
| `supabase_studio_hydi-local-supabase` | `hydi-local-supabase` | `studio` | 54323 | running healthy | OPTIONAL (Supabase Studio UI) |
| `ursula-postgres` | `ursula_suite` | `postgres` | 5432 | running healthy | REQUIRED (Ursula DB) |
| `ursula-redis` | `ursula_suite` | `redis` | 6379 | running healthy | REQUIRED (Ursula cache) |
| `ursula-hub` | `ursula_suite` | `protohub-api` | 4000 | running unhealthy | REQUIRED (ProtoHub API) |
| `ursula-flask` | `ursula_suite` | `flask-backend` | 5000 | not running | REQUIRED (Heidi Bridge `URSULA_URL`) |

## Services Not Required by HYDI Qualification

These are running but are not referenced by the HYDI `services-manifest`, `supervisor.js`, `start-hydi.js`, or `qualification-config`:

| Container | Project | Why not required |
|-----------|---------|------------------|
| `hydi-api` | `docker` (HYDI-TailNet) | Not in any HYDI startup or qualification artifact |
| `hydi-dashboard` | `docker` | TailNet dashboard; not used by qualification |
| `hydi-file-sync` | `docker` | TailNet file sync; not used by qualification |
| `hydi-loki` | `docker` | TailNet logging; not used by qualification |
| `hydi-monitoring` | `docker` | TailNet Prometheus-ish; not used by qualification |
| `hydi-notifications` | `docker` | TailNet ntfy; not used by qualification |
| `hydi-redis` | `docker` | TailNet Redis; not used by qualification |
| `hydi-remote-commands` | `docker` | TailNet remote; not used by qualification |
| `hydi-grafana` | `docker` | Exited; TailNet Grafana |
| `protoforge-grafana` | `outputs` | Not in HYDI manifest |
| `protoforge-prometheus` | `outputs` | Not in HYDI manifest |
| `protoforge-redis` | `outputs` | Not in HYDI manifest |
| `protoforge-postgres` | `outputs` | Exited; not in HYDI manifest |
| `redis` | none | Exited stale container; not referenced |

## Findings

1. The qualification target `next-app` depends on `docker-stack` per `services-manifest.json`, which in turn needs Ursula `postgres`, `redis`, and `protohub-api`.
2. `.ports.json` shows `next-app` also depends on `supabase`; the operational `database-operation` workload at `api/health` uses Supabase Postgres.
3. The local Supabase stack (`hydi-local-supabase`) is the **primary** database for `api/health`; the Ursula Postgres is **secondary** for ProtoHub/Bridge.
4. `heidi-bridge` environment variables point to `PROTOHUB_URL=http://localhost:4000` and `URSULA_URL=http://localhost:5000`, which means Ursula `flask-backend` is also needed; it is not currently running and is not started by the manifest `docker-stack` command.
5. `heidi-mobile` and `forge-loop` are marked `required: false` in `services-manifest.json`; they are not needed for the qualification.
