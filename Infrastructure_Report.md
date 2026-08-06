# Infrastructure Report

## Executive Summary

- **Docker daemon:** Running.
- **Containers:** 10 active; 1 in restart loop (`ursula-flask`).
- **Supabase local stack:** All `supabase_*` containers healthy.
- **Ollama:** v0.21.0, 7 models.
- **Node.js:** v24.11.1.
- **Next.js:** v15.5.22.
- **HEIDI runtime:** `Runtime: READY`; database connection OK.
- **Cold boot (`node src/server.js`):** 10-second run completed without crash.
- **Ursula flask:** Restart loop due to `ImportError: cannot import name 'BlameGames' from 'blame_games'`.

## Docker Container Status

| Container | Status | Ports | Notes |
|-----------|--------|-------|-------|
| `ursula-flask` | **Restarting (1)** | — | Root cause identified — see below |
| `ursula-hub` | Up 3 hours (healthy) | `4000` | |
| `ursula-postgres` | Up 3 hours (healthy) | `5432` | |
| `ursula-redis` | Up 3 hours (healthy) | `6379` | |
| `supabase_storage_hydi-local-supabase` | Up 3 hours (healthy) | `5000` | |
| `supabase_rest_hydi-local-supabase` | Up 3 hours | `3000` | |
| `supabase_realtime_hydi-local-supabase` | Up 3 hours (healthy) | `4000` | |
| `supabase_auth_hydi-local-supabase` | Up 3 hours (healthy) | `9999` | |
| `supabase_kong_hydi-local-supabase` | Up 3 hours (healthy) | `54321` | Kong gateway |
| `supabase_db_hydi-local-supabase` | Up 3 hours (healthy) | `54322` | Postgres |

## Ursula-Flask Restart Loop

### Last 30 log lines

```text
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "/app/api/ursula_server.py", line 11, in <module>
    from blame_games import BlameGames
ImportError: cannot import name 'BlameGames' from 'blame_games' (unknown location)
```

### Root cause

The `ursula_server.py` entry point cannot import `BlameGames` from the `blame_games` module. This is a Python import path or missing-file issue inside the `ursula-flask` container and is **not related to the HYDI Node/Next.js stack**.

### Recommended fix

1. Verify `blame_games.py` / `blame_games/__init__.py` exists in the container's `PYTHONPATH`.
2. If the module was renamed, update the import in `ursula_server.py` line 11.
3. Rebuild and restart the `ursula-flask` container.

This is a **low-severity** issue for HYDI release readiness because the Ursula suite is a separate Flask companion, not the core `heidi-cascade-production` release artifact.

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

- **Models present:** 7 (chat, code, embeddings).
- **Server:** Reachable on `http://localhost:11434` (verified earlier).

## Node / Next.js

- **Node.js:** `v24.11.1`
- **Next.js:** `v15.5.22`
- **npm package:** `heidi-cascade-production@0.9.0-rc.5`

## HEIDI Runtime

### `node scripts/hydi-cli.js status`

```text
HYDI OPERATING STATE
Runtime: READY
Uptime: 105ms
Events processed: 0
Recommendations: 43
Pending approvals: 0
Awaiting measurements: 0
Audit entries: 28
Learning updates: 0
Last verified action: none
Warnings:
  - Orphan event types (no sensor registered): ProjectOpened, ProjectActive, ...
  - Missing data: Observability dashboard not connected.; Project planner not connected.
```

### Database connection

```text
[DATABASE] SUPABASE_URL: http://127.0.0.1:543...
[DATABASE] SUPABASE_KEY: PRESENT
Database connection: OK
DB: true
```

### Cold boot (`node src/server.js`)

- Ran for 10 seconds.
- No crash.
- Force-stopped for test purposes (`SERVER_EXIT: -1`).
- Only warning: `SimpleKeymaker` rejects POSTs until API keys are configured.

## Commands Executed

```text
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker logs ursula-flask --tail 30
ollama list
node --version
npx next --version
node scripts/hydi-cli.js status
node -e "require('./src/database.js').testConnection().then(r => console.log('DB:', r));"
node src/server.js  # 10s cold boot
```

## Conclusion

**PASS (with one non-critical warning).** The core HYDI infrastructure is healthy: Docker, Supabase, Ollama, Node/Next.js, and the HEIDI runtime all report green. The only operational issue is the `ursula-flask` restart loop, which is isolated to the Ursula Python companion and does not block the `heidi-cascade-production` v0.9.0-rc.5 release.
