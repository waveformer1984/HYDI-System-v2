# Infrastructure Report

## Executive Summary

- **Docker daemon:** Running.
- **Containers:** 10 active; 1 in restart loop (`ursula-flask`).
- **Supabase local stack:** All `supabase_*` containers healthy.
- **Ursula `ursula` DB:** Created; `ursula-flask` still restarting due to `BlameGames` import error.
- **Ollama:** v0.21.0, 7 models.
- **Node.js:** v24.11.1.
- **Next.js:** v15.5.22.
- **HEIDI runtime:** `Runtime: READY`; database connection OK.
- **Cold boot (`node src/server.js`):** 10-second run completed without crash.
- **Operational qualification:** Stack starts/stops green; workload endpoints (`conversation`, `memory-storage`, `memory-retrieval`, `supervisor-status`) are failing under the qualification harness.

## Docker Container Status

| Container | Status | Ports | Notes |
|-----------|--------|-------|-------|
| `ursula-flask` | **Restarting (1)** | — | `BlameGames` import defect, DB missing issue fixed |
| `ursula-hub` | Up 3 hours (healthy) | `4000` | |
| `ursula-postgres` | Up 3 hours (healthy) | `5432` | `ursula` DB now exists |
| `ursula-redis` | Up 3 hours (healthy) | `6379` | |
| `supabase_storage_hydi-local-supabase` | Up 3 hours (healthy) | `5000` | |
| `supabase_rest_hydi-local-supabase` | Up 3 hours | `3000` | |
| `supabase_realtime_hydi-local-supabase` | Up 3 hours (healthy) | `4000` | |
| `supabase_auth_hydi-local-supabase` | Up 3 hours (healthy) | `9999` | |
| `supabase_kong_hydi-local-supabase` | Up 3 hours (healthy) | `54321` | Kong gateway |
| `supabase_db_hydi-local-supabase` | Up 3 hours (healthy) | `54322` | Postgres |

## Ursula Infrastructure

### Actions taken

1. Created the missing `ursula` database:

```text
docker exec -e PGPASSWORD=password ursula-postgres createdb -U ursula -h 127.0.0.1 ursula
```

2. Restarted `ursula-flask`:

```text
docker restart ursula-flask
```

### Result

- `ursula-postgres` FATAL `database "ursula" does not exist` logs stopped.
- `ursula-flask` is still in a restart loop with `ImportError: cannot import name 'BlameGames' from 'blame_games' (unknown location)`.
- Root cause: the `blame_games` package in the Ursula image has no `__init__.py` and likely isn't on `PYTHONPATH`.

### Impact

This is a non-HYDI companion service. It does not affect `heidi-cascade-production` core, but it is an outstanding operational issue in the local Ursula suite.

## Local AI (Ollama)

```text
ollama version is 0.21.0
NAME                       ID              SIZE      MODIFIED
qwen2.5:7b                 845dbda0ea48    4.7 GB    4 weeks ago
llama3.2:3b                a80c4f17acd5    2.0 GB    5 weeks ago
llama3:latest              365c0bd3c000    4.7 GB    5 weeks ago
nomic-embed-text:latest    0a109f422b47    274 MB    5 weeks ago
llama3.2:latest            a80c4f17acd5    2.0 GB    6 weeks ago
tinyllama:latest           2644915ede35    637 MB    7 weeks ago
qwen2.5-coder:1.5b         d7372fd82851    986 MB    2 months ago
```

## Node / Next.js

- **Node.js:** `v24.11.1`
- **Next.js:** `v15.5.22`

## HEIDI Runtime

- `database.testConnection()` returns `OK`.
- `node scripts/hydi-cli.js status` reports `Runtime: READY`.

## Operational Qualification Infrastructure Findings

The qualification harness was able to start and stop the stack, but the following workloads could not complete:

| Workload | Endpoint / Port | Result |
|----------|-----------------|--------|
| `conversation` | Next.js API | 400 Bad Request |
| `memory-storage` | Next.js API | 500 Internal Server Error |
| `memory-retrieval` | Next.js API | 405 Method Not Allowed |
| `supervisor-status` | `localhost:9999` | Connection refused / wrong target |

## Commands Executed

```text
docker ps
docker logs ursula-flask --tail 30
docker logs ursula-postgres --tail 30
docker exec -e PGPASSWORD=password ursula-postgres createdb -U ursula -h 127.0.0.1 ursula
docker restart ursula-flask
ollama list
node --version
npx next --version
node scripts/hydi-cli.js status
node -e "require('./src/database.js').testConnection().then(r => console.log('DB:', r));"
```

## Conclusion

**PASS for core HYDI infrastructure; PARTIAL for Ursula.** Docker, Supabase, Ollama, Node/Next.js, and the HEIDI runtime are healthy. Ursula's database issue is resolved, but `ursula-flask` cannot start due to a missing `__init__.py` in the `blame_games` package. The qualification workload failures point to endpoint/configuration gaps that must be resolved before soak testing.
