# HYDI Startup & Reliability Guide

## Overview

HYDI now has **dependency-aware startup** with port conflict detection. Services start in the correct order and wait for their dependencies to be healthy before beginning.

This prevents:
- Port conflicts (EADDRINUSE)
- Orphaned processes
- Database connection errors at startup
- Race conditions

---

## Quick Start

**Option 1: Full orchestrated startup (recommended)**
```bash
npm run start:hydi
```
This runs all checks and starts all services in dependency order.

**Option 2: Individual commands**
```bash
# Check port availability
npm run check:ports

# Wait for Supabase + Ollama to be ready
npm run wait:dependencies

# Start Next.js frontend (background: all other services)
npm run dev
```

---

## What's New

### 1. Port Registry (`.ports.json`)

Single source of truth for all ports. Lists every service and its dependencies.

Example:
```json
{
  "heidi-mobile-chat": {
    "port": 3006,
    "name": "HEIDI Mobile Chat API",
    "depends_on": ["ollama"]
  },
  "supabase": {
    "port": 54321,
    "depends_on": []
  }
}
```

**Why?** Prevents accidental conflicts and documents dependencies.

### 2. Port Checker (`npm run check:ports`)

Detects port conflicts before startup.

```bash
$ npm run check:ports

🔍 HYDI Port Registry Check

  ✓ Available  Port 3006  — HEIDI Mobile Chat API
  ✓ Available  Port 3000  — Next.js DashHub Frontend
  ✓ Available  Port 3458  — HEIDI Core Orchestrator
  ✓ Available  Port 5050  — Heidi Bridge (Flask/Python)
  ✓ Available  Port 11434 — Ollama Local LLM Server
  ✓ Available  Port 54321 — Supabase Local (PostgreSQL)

📊 Summary
  Available: 6
  In use:    0

✅ All ports available. Ready to start services.
```

If a port is in use, it tells you how to free it:
```bash
  Kill process on port 3006:
    Windows: netstat -ano | findstr :3006
             taskkill /PID <PID> /F
    Linux:   lsof -i :3006 | awk 'NR==2 {print $2}' | xargs kill -9

  Or change HEIDI Mobile Chat port in .env:
    HEIDI_PORT=3007
```

### 3. Dependency Gating (`npm run wait:dependencies`)

Blocks startup until critical services are healthy.

```bash
$ npm run wait:dependencies

⏳ Waiting for dependencies...

[12:34:56] Attempt 1/12...
         ✓ supabase (PostgreSQL + API)
         ✓ ollama (embeddings & inference)

✅ All dependencies ready!
```

If dependencies aren't ready:
```
[12:34:56] Attempt 1/12...
         ✗ supabase (Connection refused)
         ✗ ollama (Connection refused)

   Retrying in 5s...

[12:35:01] Attempt 2/12...
         ✗ supabase (PGRST002: schema cache)
         ✗ ollama (Timeout)

[12:35:20] Attempt 3/12...
         ✓ supabase
         ✓ ollama

✅ All dependencies ready!
```

### 4. Orchestrated Startup (`npm run start:hydi`)

Coordinates everything:

1. **Check ports** ← detects conflicts early
2. **Wait for dependencies** ← ensures Supabase + Ollama are healthy
3. **Start services in order**:
   - Supabase (already running, checked)
   - Ollama (already running, checked)
   - HEIDI Core (depends on Supabase + Ollama)
   - HEIDI Mobile Chat (depends on Ollama)
   - Next.js Frontend (depends on Supabase)

Each service waits for its dependencies:
```bash
⏳ Waiting for dependencies...

✅ All dependencies ready!

🔄 Starting services in order...

[12:35:24] ⏳ [1/5] Starting Supabase...
[12:35:24] ✅ Supabase started (PID 1234)

[12:35:26] ⏳ [2/5] Starting Ollama...
[12:35:26] ✅ Ollama started (PID 5678)

[12:35:28] ⏳ [3/5] Starting HEIDI Core...
[12:35:28] ✅ HEIDI Core started (PID 9012)

[12:35:30] ⏳ [4/5] Starting HEIDI Mobile Chat...
[12:35:30] ✅ HEIDI Mobile Chat started (PID 3456)

[12:35:32] ⏳ [5/5] Starting Next.js Frontend...
[12:35:32] ✅ Next.js Frontend started (PID 7890)

✅ All services started!

Dashboard: http://localhost:3000
Chat API:  http://localhost:3006
Core:      http://localhost:3458
```

---

## Troubleshooting

### Port already in use

```bash
$ npm run check:ports
  ✗ IN USE  Port 3006  — HEIDI Mobile Chat API
```

**Solution:**
```bash
# Windows
netstat -ano | findstr :3006
taskkill /PID <PID> /F

# Linux
lsof -i :3006 | awk 'NR==2 {print $2}' | xargs kill -9
```

### Dependencies not ready

```bash
$ npm run wait:dependencies
❌ Dependencies not ready after 60s. Aborting startup.

Troubleshooting:
  1. Check Supabase: supabase status
  2. Check Ollama: curl http://localhost:11434/api/tags
  3. View logs: supabase logs -f
```

**Solution:**
```bash
# Make sure Supabase is running
supabase start

# Make sure Ollama is running (separate terminal)
ollama serve

# Then retry
npm run start:hydi
```

### Service crashes on startup

Check the service logs in the orchestrator output. The system captures stdout/stderr from each service.

```bash
[HEIDI Core] Error: Cannot connect to Supabase
[HEIDI Core] Retrying...
```

---

## Architecture

### Dependency Graph

```
Supabase (PostgreSQL)
  ↓
HEIDI Core (depends on Supabase)
  ↓
HEIDI Mobile Chat (depends on HEIDI Core + Ollama)
  ↓
Next.js Frontend (depends on HEIDI Core + Supabase)

Ollama (independent, started in parallel)
```

### Port Map

| Service | Port | Depends On |
|---------|------|-----------|
| Supabase DB | 54321 | — |
| Supabase REST | 3001 | Supabase |
| Ollama | 11434 | — |
| HEIDI Core | 3458 | Supabase, Ollama |
| HEIDI Mobile Chat | 3006 | Ollama |
| Next.js Frontend | 3000 | Supabase |
| Heidi Bridge (Python) | 5050 | Supabase |

---

## Environment Variables

Set these in `.env.local` to customize ports:

```bash
# Override default ports
PORT=3000                  # Next.js
HEIDI_PORT=3006           # HEIDI Mobile Chat
HEIDI_CORE_PORT=3458      # HEIDI Core
HEIDI_BRIDGE_PORT=5050    # Heidi Bridge
SUPABASE_DB_PORT=54321    # Supabase (if running locally)
OLLAMA_PORT=11434         # Ollama
```

---

## Next Steps: Production Readiness

These four items have now been addressed:

- ✅ **Port collisions eliminated** (registry + checker)
- ✅ **Startup orchestration** (dependency-aware startup)
- ⚠️ **Database readiness** (health checks in place)
- ⏳ **Workers restart automatically** (next phase)

Remaining priorities:
1. Worker crash handling (wrap all promises)
2. Structured logging (JSON output)
3. Graceful shutdown (drain queues)
4. 24-hour soak test (validate stability)

See `STABILITY_ROADMAP.md` for the full plan.

---

## Questions?

Run startup with debug output:
```bash
DEBUG=* npm run start:hydi
```

Check the port registry:
```bash
cat .ports.json | jq '.services'
```

Verify dependencies are healthy:
```bash
curl http://localhost:54321/health  # Supabase
curl http://localhost:11434/api/tags  # Ollama
```
