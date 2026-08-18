# HYDI Runtime Recovery Report

**Generated:** 2026-08-17T23:13:00Z
**Canonical repository:** `C:\Users\Owner\HYDI-System-v2`
**Branch:** `feat/local-dev-automation`

## Recovery Actions Taken

### 1. Repository Identity (G0)

**Problem:** 20 HYDI-related directories existed on the machine, including 3 clones of the same remote (`HYDI-System-v2.git`). Previous agents modified divergent branches or repository copies without conclusively proving which was canonical.

**Recovery:**
- Discovered and classified all 20 directories.
- Established `C:\Users\Owner\HYDI-System-v2` as the single canonical repository.
- Created `CANONICAL.md` with quarantined copies table and verification procedure.
- Created `scripts/verify-canonical.js` identity gate.
- Wired identity gate into preflight as the first check.
- Fixed stale path references in `unified-system-sitrep.js`, `services-manifest.json`, and `apps/ursula-frontend/.hydi/config.json`.

**Evidence:** `node scripts/verify-canonical.js` passes (exit 0).

### 2. Health System (G2)

**Problem:** The historical health system reported success while the actual system was broken. Hard-coded port lists could drift from the actual module configuration.

**Recovery:**
- Created `scripts/health-check.js` — a config-derived health checker that:
  - Derives all health targets from `boot.config.json`
  - Checks port occupancy, process identity, health endpoint, and response body
  - Performs real service-role write/read/delete against the database
  - Checks Ollama reachability and model availability
  - Detects stale WSL2 port proxies
- Updated `scripts/preflight.js` to derive port checks from `boot.config.json`
- Updated `scripts/watchdog.js` to derive endpoints from `boot.config.json`

**Evidence:** `node scripts/health-check.js` reports ALL REQUIRED MODULES HEALTHY with per-check detail.

### 3. Process/Network/Runtime (G3)

**Problem:** Stale processes, zombie ports, and potential WSL2 port proxy interference.

**Recovery:**
- Preflight automatically detects and kills zombie processes on configured ports.
- Preflight checks Docker Desktop availability.
- Preflight verifies Supabase CLI version.
- Health checker detects stale WSL2 port proxies.
- Boot agent supervises all modules and shuts down on required-module failure.

**Evidence:** Clean boot with all 4 modules up. Failure injection (killing protoforge-core) triggered clean shutdown.

### 4. Database/Persistence (G4)

**Problem:** Previous database access issues caused by stale WSL2 port proxy. Service-role access needed verification.

**Recovery:**
- Verified local Supabase is the default (`http://127.0.0.1:54321`).
- Verified service-role write/read/delete against `leads` table.
- Confirmed LOCAL_FIRST persistence strategy.

**Evidence:** Health check database section: all 4 checks PASS.

### 5. End-to-End Path (G5)

**Problem:** Need to verify the complete chain: Heidi → API/Bridge → ProtoForge/CASCADE/KILO → persistence.

**Recovery:**
- Verified all 6 chat agents (heidi, ursula, cascade, kilo, protoforge, hyve) return HTTP 200 through the universal chat route at `/api/chat`.
- Verified the chat route authenticates via `x-hydi-service-token` header.
- Verified SSE streaming response format.

**Evidence:** All 6 agents: HTTP 200.

### 6. Security (G8)

**Problem:** A live Stripe key (`sk_live_...`) was previously found in the Windows process environment. A GitHub PAT is embedded in `C:\HYDI_System`'s remote URL.

**Recovery:**
- Verified `STRIPE_SECRET_KEY` is NOT in `.env.local`, `.env`, or Windows user environment.
- Verified the live key persists only in contaminated PowerShell process environments (inherited from previous sessions).
- Preflight guardrail correctly blocks any `sk_live_` key.
- Secret scanner confirms no live secrets in 3811 tracked files.
- Documented the `C:\HYDI_System` PAT exposure in `CANONICAL.md`.

**Remaining action (requires user):**
- Clear `STRIPE_SECRET_KEY` from any contaminated PowerShell sessions: open a fresh terminal.

**Resolved:**
- `C:\HYDI_System` GitHub PAT: The PAT was confirmed already revoked (HTTP 401). The remote URL was scrubbed, then the entire `C:\HYDI_System` directory was deleted on 2026-08-17 per explicit user request. The token no longer exists on this machine.

### 7. Governance (G7)

**Problem:** July 24 audit identified 113 branches/refs. 57 branches were in an error/unresolved state after cleanup.

**Current state:**
- Total branches: 76
- Merged into clean-main: 14 (safe to delete)
- Diverged: 57
  - 39 already archived (PRESERVED as evidence)
  - 10 `claude/*` remote branches not yet archived (recommend ARCHIVE)
  - 2 obsolete (`origin/main`, `origin/hydi-system-ops-fixes`)
  - 1 stale remote feature branch (`origin/feature/hydi-v2-infra-port`)
  - 1 active working branch (`feat/local-dev-automation`)
  - 3 local branches with unique commits (PRESERVED)
  - 1 canonical remote (`origin/clean-main`)

**Disposition:** See branch inventory in `HYDI_NEXT_GATE_OPERATIONAL_REPORT.md`.

### 8. Failure Injection Results (G6)

| Failure | Detected? | Health System Response | Recovery |
|---------|-----------|----------------------|----------|
| Kill protoforge-core (required) | YES | "port 3005 not occupied — process not running" | Boot-agent shut down all modules cleanly |
| Wrong process on port 3005 (Python instead of Node) | YES | "wrong process on port 3005: expected node, found python (PID 14120)" | Health check reports UNHEALTHY |
| Live Stripe key in environment | YES | "STRIPE_SECRET_KEY starts with sk_live_ — ABORTING" | Preflight exits with code 1 |
| Wrong database URL | YES | "service-role-write: fetch failed" | Health check reports UNHEALTHY |
| Kill heidi-mobile-chat (optional) | YES | "port 3006 not occupied — process not running" | Health check reports optional module down, required modules still healthy |

## Remaining Issues

1. **Local model executable missing** — `./bin/main` ENOENT. The orchestrator tries to spawn local model binaries that don't exist. Falls back to API models. Non-fatal but affects response quality.
2. **`failure_mitigation` adaptation type unknown** — The core loop applies an adaptation type that isn't registered. Non-fatal.
3. **~~`C:\HYDI_System` PAT exposure~~** — RESOLVED. PAT was already revoked (HTTP 401). Remote URL scrubbed, directory deleted 2026-08-17.
4. **Process environment contamination** — Live Stripe key can persist in PowerShell process environment across sessions. A fresh terminal is needed after clearing.
5. **14 merged branches** can be safely deleted to reduce branch noise.
6. **10 `claude/*` remote branches** should be archived or deleted.
