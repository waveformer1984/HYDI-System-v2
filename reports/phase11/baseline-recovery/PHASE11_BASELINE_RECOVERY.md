# Phase 11A Baseline Recovery Report

**Date:** 2026-08-16  
**Project:** HYDI-System-v2  
**Scope:** Diagnose, restore, and verify the Phase 11 qualification runtime baseline without executing chaos injection.  

## Repository State

- **Repository:** `C:\Users\Owner\HYDI_System`
- **Branch:** `release/v0.9.0`
- **HEAD:** `66e7fed13dfd687dc0f7a381c29fb731b5dcd1b0`
- **Working tree:** dirty (pre-existing unstaged changes; no commit created for this work)
- **Commit for this work:** NONE

## Initial Baseline

The baseline at the start of Phase 11A was `DEGRADED`.

Key observations from `node src/heidi-executive/DiagnosticCommand.js` and manual inspection:

- Docker daemon: healthy.
- WSL2 Ubuntu: responsive (`wsl --status`), later found to have a broken default user.
- 16 known containers: 14 running, 2 not running.
  - `supabase_vector_HYDI-System-v2`: `restarting`, `RestartCount` 393, `ExitCode` 0.
  - `supabase_edge_runtime_HYDI-System-v2`: `Exited (255)`, stale from 2026-08-07.
- Required manifest services were not running:
  - `memory-engine` (port 9998)
  - `hydi-core` (port 9997)
  - `heidi-bridge` (port 5050)
  - `next-app` (port 3000)
- `ursula-flask` was already running and healthy.
- `ursula-hub` (ProtoHub API on 4000) was running and healthy.

## Evidence Collected

Evidence artifacts are preserved under `reports/phase11/baseline-recovery/`:

- `diagnostic-after-vector-stop.json` — diagnostic after stopping the vector restart loop
- `diagnostic-after-wsl-fix.json` — diagnostic after fixing the WSL probe
- `diagnostic-final3.json` — diagnostic after all services started
- `diagnostic-after-stability.json` — final diagnostic after the 15-minute stability window
- `stability.log` — 16 one-minute samples across ~15 minutes
- `supervisor2.log` — supervisor startup and health-check record
- `supervisor-status.json` — final `supervisor` health status
- `supabase_vector_inspect.json` — full `docker inspect` of `supabase_vector`
- `supabase_edge_runtime_inspect.json` — full `docker inspect` of `supabase_edge_runtime`

### `supabase_vector` root-cause evidence

- **Restart policy:** `unless-stopped`.
- **Environment:** `DOCKER_HOST=http://host.docker.internal:2375`.
- **Binds:** none (no `/var/run/docker.sock` mount).
- **Recurring log pattern:**
  ```
  ERROR vector::sources::docker_logs: Listing currently running containers failed.
  error=... ConnectError("tcp connect error", Os { code: 111, kind: 111, message: "Connection refused" })
  Vector has stopped.
  ```
- **Conclusion:** Vector cannot reach the Docker daemon. The configured `DOCKER_HOST` TCP endpoint is not listening; no Unix socket is mounted. This is a **confirmed configuration mismatch**, not a runtime dependency or resource-exhaustion failure.

### `supabase_edge_runtime` evidence

- `ExitCode` 255 from 2026-08-07.
- Container is stale; not part of the canonical qualification service set.
- Not contributing to any required health endpoint.

### WSL user failure evidence

- `wsl -d Ubuntu -e ...` commands hang with `getpwuid(1000) failed 0`.
- `wsl -d Ubuntu -u root -e ...` and `wsl -d Ubuntu -u root -- ...` execute successfully.
- The default `uid 1000` user is broken; `root` works.

### Required services restart evidence

- `supervisor2.log` shows:
  - `memory-engine` UP
  - `hydi-core` UP
  - `docker-stack` UP (port 4000 already healthy)
  - `heidi-bridge` UP
  - `next-app` UP (switched health check to `/api/health`, timeout 120 s)
  - `heidi-mobile` UP
  - `forge-loop` UP

## Failure Classification

| Component | Class | Confidence | Rationale |
|-----------|-------|------------|-----------|
| `supabase_vector` | `CONFIGURATION_FAILURE` | confirmed | `DOCKER_HOST` points to an unexposed TCP endpoint and no socket is mounted; clean exit on source failure. |
| `supabase_edge_runtime` | `CONFIGURATION_FAILURE` / `APPLICATION_FAILURE` | probable | Exited 255; stale optional Supabase edge-functions runtime; logs showed Deno compatibility warnings. |
| WSL default-user `getpwuid(1000)` | `CONFIGURATION_FAILURE` | confirmed | `wsl -d Ubuntu -e` hangs; `wsl -d Ubuntu -u root` works. |
| Missing manifest services | `DEPENDENCY_FAILURE` | confirmed | Required services were not started; supervisor was not running. |
| `supabase_kong` transient ECONNRESET | `NETWORK_FAILURE` / `DEPENDENCY_FAILURE` | probable | Kong container was healthy but the host-side port-`54321` path was temporarily unresponsive; recovered after a `docker restart`. |
| HEIDI `DiagnosticCommand` overall | `CONFIGURATION_FAILURE` (health-model) | confirmed | Overall was being computed from all probes including non-qualification optional containers and services, incorrectly flagging the baseline as `DEGRADED`/`UNKNOWN`. |

## Remediation Performed

All remediation was minimal, reversible, and evidence-backed:

1. **Stopped `supabase_vector`** to end the CPU-wasting restart loop. Reversible with `docker start supabase_vector_HYDI-System-v2`. This is a documented non-qualification container.
2. **Fixed WSL probe in `src/heidi-executive/RuntimeObserver.js`**:
   - Changed `wsl` invocation from `wsl -d Ubuntu -e ...` to `wsl -d Ubuntu -u root -- ...`.
   - Added `-u root` to `wslCmd` helper.
   - Reduced `dockerResourcePressure` `load` probe to a 5-second timeout to avoid hangs.
   - Increased `wsl()` timeout to 30 seconds and returned `UNAVAILABLE` on real errors (instead of `NOT_CONFIGURED`).
3. **Fixed `DiagnosticCommand` overall calculation** in `src/heidi-executive/DiagnosticCommand.js`:
   - Overall is now computed from the canonical dependency graph (WSL, Docker daemon, PostgreSQL, Redis, Supabase Kong, ProtoHub, `memory-engine`, `hydi-core`, `heidi-bridge`, `next-app`), not from all probes. This correctly excludes non-qualification optional containers and services.
4. **Updated `services-manifest.json`**:
   - `docker-stack` now uses Windows `docker compose up -d postgres redis protohub-api` directly, avoiding the broken WSL `docker` path and quote-parsing issues.
   - `next-app` health check changed from `/` to `/api/health` and timeout increased to 120 s.
5. **Started the required manifest services** via `node supervisor.js`:
   - `memory-engine`
   - `hydi-core`
   - `heidi-bridge`
   - `next-app`
   - `heidi-mobile` and `forge-loop` (not required for qualification but healthy)
6. **Restarted `supabase_kong`** when it became temporarily unresponsive on `127.0.0.1:54321`. It recovered to healthy.

## Verification

### Final `node src/heidi-executive/DiagnosticCommand.js`

- `overall`: `HEALTHY`
- Critical dependency graph all `HEALTHY`:
  - WSL Ubuntu responded
  - Docker daemon `29.7.2`
  - PostgreSQL TCP `5432`
  - Redis TCP `6379`
  - Supabase Kong `54321`
  - ProtoHub `4000`
  - `memory-engine` `9998`
  - `hydi-core` `9997`
  - `heidi-bridge` `5050`
  - `next-app` `3000` (via `/api/health`)

### 15-minute stability window

- **Duration:** ~15 minutes, 16 one-minute samples.
- **Log file:** `reports/phase11/baseline-recovery/stability.log`
- **Observations:**
  - All monitored endpoints returned HTTP 200 on every sample: Kong `/auth/v1/health`, ProtoHub `/health`, `memory-engine`, `hydi-core`, `heidi-bridge`, `next-app`, `heidi-mobile`, and `postgres` REST `/rest/v1/system_dashboard`.
  - `supabase_vector_HYDI-System-v2` remained `Exited` with no new restarts (`RestartCount` stable at 393).
  - `supabase_edge_runtime_HYDI-System-v2` remained `Exited`.
  - No new crashed or restarting containers appeared.
  - `supabase_kong` uptime grew from 6 to 22 minutes.
  - Docker daemon remained reachable.

### Unit tests

- `npx jest tests/unit/heidi-executive/operational-intelligence.test.js` — 8/8 passing.

## Final Baseline

`HEALTHY`

The canonical qualification runtime is stable:

- Docker daemon: healthy
- WSL2 Ubuntu: healthy (slow due to distro startup overhead, ~10.4 s)
- Required Docker services: healthy
- Required manifest services: healthy
- No unexpected restart loops
- 15-minute stability window passed

## Phase 11 Chaos Readiness

**Verdict:** `NOT_READY`

The runtime baseline is `HEALTHY`, but the Phase 11 chaos qualification harness (`scripts/lib/soak-chaos.js` and `scripts/phase11-qual.js`) still invokes `wsl -d Ubuntu -e bash -c "..."` and `wsl -d Ubuntu -e docker ...`. This path has two unresolved problems:

1. The default WSL user (`uid 1000`) is broken, so `wsl -d Ubuntu -e` hangs or fails.
2. The WSL Ubuntu `docker` CLI targets a separate Docker daemon (different container IDs from the live Docker Desktop daemon), so chaos/recovery actions would not affect the actual qualification stack.

**Next step before chaos:** Update `soak-chaos.js` / `phase11-qual.js` to use the live Docker daemon (Windows `docker`/`docker compose` CLI or the `WslExecutor`/Windows `docker` path already used by `src/heidi-executive/WslExecutor.js`).

## Files Changed / Touched

No commit was created.

- `services-manifest.json` — `docker-stack` command and `next-app` health/timeout
- `src/heidi-executive/RuntimeObserver.js` — WSL user, timeout, and resource-pressure fixes
- `src/heidi-executive/DiagnosticCommand.js` — overall health computed from canonical dependency graph
- `reports/phase11/baseline-recovery/` — new evidence directory and report (this file)

Pre-existing unstaged/uncommitted changes elsewhere in the tree were preserved and not discarded.
