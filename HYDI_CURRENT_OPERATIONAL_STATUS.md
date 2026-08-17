# HYDI Current Operational Status

**Generated:** 2026-08-17T23:13:00Z
**Canonical repository:** `C:\Users\Owner\HYDI-System-v2`
**Branch:** `feat/local-dev-automation`
**Commit:** `b74ee51`

## Runtime State

All health targets are derived from `boot.config.json` — not hard-coded.

### Module Health

| Module | Port | Required | Status | Process | Health Endpoint |
|--------|------|----------|--------|---------|-----------------|
| protoforge-core | 3005 | yes | **HEALTHY** | node (PID verified) | HTTP 200 |
| heidi-web | 3000 | yes | **HEALTHY** | node (PID verified) | HTTP 200 |
| heidi-mobile-chat | 3006 | no | DOWN (killed during failure injection test) | — | — |
| hydi-orchestrator | (in-process) | no | **UP** | in-process | depends on protoforge-core |
| hardware-agent | — | no | disabled | — | — |
| trading-loop | — | no | disabled | — | — |

### Database Health

| Check | Status |
|-------|--------|
| REST API reachable | **PASS** (HTTP 200) |
| Service-role write | **PASS** (insert succeeded) |
| Service-role read | **PASS** (read back verified) |
| Service-role delete | **PASS** (cleanup succeeded) |

**Database target:** `http://127.0.0.1:54321` (local Supabase, Docker-backed)
**Persistence mode:** LOCAL_FIRST

### AI Runtime

| Check | Status |
|-------|--------|
| Ollama reachable | **PASS** (HTTP 200) |
| Models available | **PASS** (7 models: qwen2.5:7b, llama3.2:3b, llama3:latest, nomic-embed-text, llama3.2:latest, tinyllama:latest, qwen2.5-coder:1.5b) |

### Network

| Check | Status |
|-------|--------|
| WSL2 port proxy | **PASS** (no stale proxies) |

### End-to-End Path

| Test | Result |
|------|--------|
| Universal chat route (all 6 agents) | **PASS** — heidi, ursula, cascade, kilo, protoforge, hyve all return HTTP 200 |
| Service-role CRUD | **PASS** — write/read/delete on `leads` table |

## Evidence Commands

```bash
# Full health check (config-derived)
node scripts/health-check.js

# JSON output for automation
node scripts/health-check.js --json

# Watchdog one-shot
node scripts/watchdog.js --once

# Preflight (includes canonical identity gate)
node scripts/preflight.js

# Repository identity gate
node scripts/verify-canonical.js
```

## Known Runtime Warnings (non-blocking)

1. **`spawn ./bin/main ENOENT`** — The orchestrator tries to spawn local model executables (`gpt-35-turbo`, `gpt-4-local`, `local-llama`) via `./bin/main` which doesn't exist. The system falls back to API models (OpenAI/Gemini). This is a configuration issue, not a crash.

2. **`Unknown adaptation type: failure_mitigation`** — The core loop applies an adaptation type that isn't registered. Non-fatal; the loop continues.

3. **Model response quality** — The chat route returns HTTP 200 but model responses may be fallback messages ("I apologize, but I'm having trouble processing your request right now.") when local models fail and API models are slow or rate-limited.

## Classification

- **Observed fact:** All 3 required modules respond with HTTP 200 on their health endpoints.
- **Test result:** Service-role write/read/delete succeeded against local Supabase.
- **Test result:** All 6 chat agents return HTTP 200.
- **Test result:** Failure injection correctly detected by health system.
- **Inference:** The system is operational for local-first development.
- **Unresolved issue:** Local model executable (`./bin/main`) is missing — affects orchestrator model calls but not health.
