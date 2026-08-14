# HYDI Local-First Persistence Final Qualification Report

## Scope

Qualify HYDI to operate with the cloud Supabase project `akbnfovjdcobifeupvbn` fully inactive, using the canonical local Supabase/Postgres stack as the only operational persistence.

## Baseline

- Branch: `release/v0.9.0`
- HEAD: `6734be85db6e91757610f17f8b23e752f7266a24`
- `npm run typecheck`: PASS
- `npm test` (pre-soak): 2421 passed, 2 unrelated WSL git-spawn timeouts, 1 skipped
- `npm run hydi:readiness`: READY
- `npx jest tests/unit/persistence-guard.test.js`: PASS
- `./verify-supabase.sh`: 26 PASSED, 14 WARNINGS, 0 FAILED
- `scripts/backup-local-db.sh`: PASS
- `scripts/restore-local-db.sh <latest backup>`: PASS

## Architecture

```text
HYDI
  ↓
HYDI_PERSISTENCE_MODE (local | cloud | auto)
  ↓
src/persistence/supabase-client.js  (factory)
  ↓
LOCAL SUPABASE  (default)
  ↓
127.0.0.1:54321 / 54322
  ↓
PostgreSQL 17  (persistent Docker volume)

Optional:
  ↓
CLOUD SUPABASE  (configured as *_CLOUD)
```

## Gate 1 — Auto-Mode Contract

The persistence factory is in `src/persistence/supabase-client.js`.

Contract:

- `HYDI_PERSISTENCE_MODE=local` uses `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (or `*_LOCAL` variants).
- `HYDI_PERSISTENCE_MODE=cloud` uses `SUPABASE_URL_CLOUD` / `SUPABASE_SERVICE_ROLE_KEY_CLOUD`.
- `HYDI_PERSISTENCE_MODE=auto` health-probes the **local** endpoint first; if healthy it wins, otherwise it probes the **cloud** endpoint and falls back with `fallback_reason=local_unavailable`.
- If both are unavailable, the factory returns the **local** configuration so failures are truthful.
- The factory is startup-time selection; it does **not** silently switch persistence source mid-write.

Write safety: `auto` selects one source per process lifetime. If that source fails during a write, the operation fails. There is no mid-write cloud fallback. This is fail-closed for writes.

Auditability: the factory logs `HYDI_PERSISTENCE_MODE`, selected `source`, `url` prefix, and `fallback_reason` to `stdout` on every initialization.

## Gate 2 — Auto-Mode Controlled Test

Script: `scripts/auto-mode-test.js`

Results:

| Case | Local | Cloud | Source | Result |
|---|---|---|---|---|
| local up / cloud up | real local | real local (stand-in) | `local` | PASS |
| local up / cloud down | real local | unroutable | `local` | PASS |
| local down / cloud up | unroutable | real local (stand-in) | `cloud` (fallback) | PASS |
| local down / cloud down | unroutable | unroutable | `local` (truthful fail) | PASS |

The "cloud" stand-in is the real local Supabase endpoint. No real cloud credentials were used. The factory proved:

- local wins when healthy
- observable cloud fallback when local is unavailable
- truthful failure when both are unavailable

## Gate 3 — Auto-Mode Write Safety

- `auto` does **not** perform mid-operation failover.
- If the selected persistence source becomes unavailable, `src/database.js` helpers degrade gracefully (return `null`/empty/error) instead of fabricating success.
- No dual writes and no split-brain.
- Writes are fail-closed at the operation boundary.

## Gate 4 — Auto-Mode Auditability

Factory logs include:

```
[persistence] HYDI_PERSISTENCE_MODE=auto; using Supabase source=cloud (fallback_reason=local_unavailable) url=http://127.0.0.1:543...
```

Every switch is observable; no silent `local -> cloud`.

## Gate 5 — 1-Hour Local Endurance Soak

Script: `scripts/local-first-soak.py`

- Artifact path: `artifacts/local-first-soak/20260814-141324/`
- Duration: 3600 seconds
- Start: `2026-08-14T14:13:24.506292+00:00`
- End: `2026-08-14T15:13:24.428367+00:00`
- Interval: 45 seconds
- Iterations: 79

### Soak operations exercised

- `api/health`
- `api/ursula/status`
- `GET rezonate_projects`
- `PATCH rezonate_tracks`
- `GET rezonate_tracks`
- `POST system_health_runs`
- `tools/dashboard-status/status_collector.py` (bridge)

### Restart events

- `docker stop/start supabase_db_HYDI-System-v2` was executed. The container stopped and started successfully.
- `pkill -f "next dev"` was executed. HYDI was restarted with `npx next dev`.

### Soak results

- Total operations: 553
- Successful: 167
- Failures: 386
- Success rate: 30.2%

| Operation | Success | Failures | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| health | 44 | 35 | 87.85 | 150.43 |
| ursula | 44 | 35 | 103.55 | 172.27 |
| project_get | 0 | 79 | — | — |
| track_update | 0 | 79 | — | — |
| tracks_list | 0 | 79 | — | — |
| system_health | 0 | 79 | — | — |
| collector | 79 | 0 | 1102.0 | 1875.74 |

### Failure analysis

**Every `project_get`, `track_update`, `tracks_list`, and `system_health` operation failed with the same test-harness error:**

```
unknown url type: '/rest/v1/rezonate_projects?id=eq.<id>&select=*'
```

This means the soak script's `SUPABASE_URL` environment variable was empty when the Python process started, so the constructed REST URLs were local paths (`/rest/v1/...`) rather than full URLs. The failure is in the test harness, not in HYDI or the local Supabase/Postgres stack.

- `health` and `ursula` used full `http://localhost:3001/...` URLs (set via `HYDI_BASE`) and succeeded.
- `collector` used local service calls and succeeded 100%.

The controlled DB restart and HYDI restart happened, but the soak cannot prove persistence/data integrity because the persistence REST calls were not actually reaching Supabase.

### Cloud isolation during soak

- `HYDI_PERSISTENCE_MODE=local` was set.
- Cloud URL was already configured as the inactive/unroutable project.
- No cloud traffic was attempted or observed.

## Gate 6 — Data Integrity

- Project and track CRUD was verified independently before the soak.
- The 1-hour soak did not re-exercise project/track persistence because of the empty `SUPABASE_URL` in the Python harness.
- No new test records were created by the soak, so no data integrity loss occurred.

## Gate 7 — Security

- Searched `dashboard/`, `public/`, `tools/`, `backups/`, `artifacts/` for secret values.
- No raw `SUPABASE_SERVICE_ROLE_KEY`, `HYDI_STATUS_BRIDGE_SECRET`, `DASHBOARD_STATUS_TOKEN`, or Stripe live keys were found in artifacts.
- `.gitignore` excludes `backups/`, `.env*`, and `artifacts/local-first-soak/`.
- Real cloud credentials were not reactivated or introduced.

## Gate 8 — Final Regression

| Check | Result | Notes |
|---|---|---|
| `npm run typecheck` | PASS | |
| `npm test` | 2421 pass / 2 WSL git-spawn timeouts / 1 skip | pre-existing, unrelated to persistence |
| `npx jest tests/unit/persistence-guard.test.js` | PASS | |
| `npm run hydi:readiness` | READY | |
| `scripts/backup-local-db.sh` | PASS | latest `20260814-050959` |
| `scripts/restore-local-db.sh` | PASS | 106 tables, 1 `system_health_runs` row, 672 constraints |
| `./verify-supabase.sh` | PASS | 14 non-blocking warnings |

## Gate 9 — Git / Change Audit

Tracked changes are the expected local-first implementation files:

- `src/persistence/supabase-client.js` (new)
- `src/database.js` (factory wiring)
- `tests/unit/persistence-guard.test.js` (new)
- `scripts/backup-local-db.sh`, `scripts/restore-local-db.sh`
- `scripts/auto-mode-test.js`, `scripts/local-first-soak.py`
- `docs/*` reports and matrices
- `HYDI_LOCAL_FIRST_PERSISTENCE_REPORT.md`
- `.gitignore`

`backups/`, `artifacts/`, and `.env*` are untracked and excluded.

## Gate 10 — Corrected 1-Hour Local Endurance Soak

### Previous Soak Disposition

- Artifact path: `artifacts/local-first-soak/20260814-141324/`
- Status: **INVALID TEST RUN**
- Reason: **SOAK HARNESS CONFIGURATION FAILURE**
- The 386 `unknown url type: '/rest/v1/...'` failures were caused by an empty `SUPABASE_URL` in the Python harness. They must **not** be counted as HYDI persistence failures. The previous one-hour run is not qualification evidence.

### Harness Remediation

- `scripts/local-first-soak.py` now explicitly loads `.env` and `.env.local` if variables are not already set, stripping quotes/CRLFs.
- `validate_config()` fails fast if `SUPABASE_URL` is missing, empty, malformed, non-HTTP, or identical to `SUPABASE_URL_CLOUD` while `HYDI_PERSISTENCE_MODE=local`.
- A sanitized configuration summary is printed before any timed work begins.
- A preflight phase checks local Supabase, HYDI health, Ursula, the dashboard collector, and a real persistence write before the 60-minute clock starts.
- The harness now exercises project create/read/update/list, track create/read/update/list, and `system_health_runs` persistence.
- A regression test was added in `scripts/local-first-soak-harness-test.py` for the exact `SUPABASE_URL` missing/invalid/path/cloud cases.

### Corrected Soak

- Script: `scripts/local-first-soak.py`
- Mode: `HYDI_PERSISTENCE_MODE=local`
- Artifact path: `artifacts/local-first-soak/20260814-154104/`
- Duration: 3600 seconds
- Start: `2026-08-14T15:41:04.190421+00:00`
- End: `2026-08-14T16:41:09.317330+00:00`
- Interval: 45 seconds
- Cycles: 79

| Operation | Success | Failures | p95 (ms) | p99 (ms) |
|---|---|---|---|---|
| health | 79 | 0 | 78.1 | 87.18 |
| ursula | 79 | 0 | 82.0 | 141.38 |
| project_get | 79 | 0 | 284.1 | 302.18 |
| project_update | 79 | 0 | 281.7 | 332.66 |
| project_list | 79 | 0 | 248.6 | 363.72 |
| track_get | 79 | 0 | 252.1 | 345.92 |
| track_update | 79 | 0 | 266.4 | 351.4 |
| tracks_list | 79 | 0 | 287.9 | 440.42 |
| track_create | 79 | 0 | 298.7 | 394.3 |
| system_health | 79 | 0 | 321.7 | 441.68 |
| collector | 80 | 0 | 1054.85 | 2976.11 |

- Total operations: 870
- Successful: 870
- Failures: 0
- Success rate: **100.0%**

### Restart and data-integrity events

- `docker stop/start supabase_db_HYDI-System-v2` was executed at approximately 15 minutes. The database recovered and all subsequent operations succeeded. Pre-restart project and track IDs remained retrievable.
- `pkill -f "next dev"` / `npx next dev --port 3001` was executed at approximately 33 minutes. HYDI health, Ursula, project, and track retrieval resumed successfully.
- Direct data-integrity checks after creation, after DB restart, and after HYDI restart all succeeded.
- Cloud isolation: `SUPABASE_URL_CLOUD` remained `http://192.0.2.1:54321` (unroutable); no cloud persistence traffic was observed.

### Regression after soak

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npx jest tests/unit/persistence-guard.test.js` | PASS |
| `npm run hydi:readiness` | READY |
| `scripts/backup-local-db.sh` | PASS |

## Final Qualification

### What is proven

- Local Supabase/Postgres is healthy and reachable.
- HYDI health, Ursula, dashboard collector, and bridge operate fully on local.
- Auto-mode routing is verified with controlled local stand-ins.
- Cloud Supabase is not a dependency in `local` mode.
- Backup/restore works.
- Persistence guard, typecheck, tests, readiness, and verify pass.
- The corrected 1-hour soak ran for 3600 seconds with 100% success across health, Ursula, project CRUD, track CRUD, system health, dashboard collector, database restart, HYDI restart, and data integrity.

### Final Verdict

| Capability | Status |
|---|---|
| **LOCAL-FIRST RUNTIME** | **GO** — corrected 1-hour soak demonstrates project/track persistence, restart recovery, data integrity, dashboard bridge, and cloud isolation. |
| **LOCAL PERSISTENCE** | **GO** — local Supabase/Postgres and the persistence factory sustain real CRUD and recover from restarts. |
| **DASHBOARD/BRIDGE** | **GO** — collector uploaded successfully every cycle. |
| **AUTO MODE** | **VERIFIED (CONTROLLED TEST)** — routing matrix passes with local stand-ins. Real cloud failover not verified because the cloud project is inactive. |
| **CLOUD SUPABASE** | **INACTIVE / OPTIONAL** — not required for local HYDI operation. |

### Final Architectural Statement

```text
LOCAL HYDI
    ↓
LOCAL PERSISTENCE FACTORY
    ↓
LOCAL SUPABASE / POSTGRES
    ↓
LOCAL PERSISTENT STORAGE
```

HYDI is operationally independent of the inactive cloud Supabase project. Cloud Supabase remains optional future synchronization/failover infrastructure. Real cloud failover has not been verified.
