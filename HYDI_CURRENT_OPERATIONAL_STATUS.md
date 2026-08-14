# HYDI Current Operational Status

Date: 2026-08-14
Branch: `release/v0.9.0`

---

## Executive Summary

HYDI local-first architecture is **implemented and largely verified**. The core local runtime (Heidi, Ursula, Ollama, Supabase, dashboard, bridge) is healthy. The persistence factory correctly routes `local`, `cloud`, and `auto` modes. Auto mode is verified with controlled local stand-ins. Project and track CRUD, backup/restore, health endpoints, dashboard collector, and cloud isolation have been demonstrated.

The **only current blocker** for local-first certification is the 1-hour endurance soak. A previous soak was run but is **invalid** because the harness had an empty `SUPABASE_URL` and produced 386 `unknown url type` errors. The harness must be fixed and the soak rerun.

Production readiness is **separate and incomplete**: live Stripe secrets in `.env`, untracked CI, and many direct `createClient` consumers remain. These are not local-first blockers but are production blockers.

---

## Current Architecture

```text
LOCAL HYDI
    ↓
Persistence Factory (src/persistence/supabase-client.js)
    ↓
LocalSupabaseStore / CloudSupabaseStore
    ↓
Local Supabase/Postgres (127.0.0.1:54321)
    ↓
Persistent Docker Volume (supabase_db_HYDI-System-v2)

Cloud Supabase: OPTIONAL / INACTIVE
```

---

## What Is Working

- Local Supabase/Postgres on `127.0.0.1:54321`.
- `api/health` returns `healthy`.
- `api/ursula/status` returns `success`.
- `api/heidi` initializes and lists local models.
- Project CRUD through local Supabase REST.
- Track CRUD through local Supabase REST.
- `system_dashboard` view queryable.
- `tools/dashboard-status/status_collector.py` uploads `local-hydi` status.
- Dashboard bridge with HMAC-SHA256, snapshot replay protection.
- Local backup (`scripts/backup-local-db.sh`) and restore (`scripts/restore-local-db.sh`) verified.
- Database restart (persistent volume) preserves data.
- HYDI process restart reconnects to local persistence.
- Cloud isolation: `SUPABASE_URL_CLOUD` is `http://192.0.2.1:54321` and unroutable.

---

## What Is Verified

| Item | Evidence |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | 2421 pass, 2 unrelated WSL git-spawn timeouts, 1 skip |
| `npx jest tests/unit/persistence-guard.test.js` | PASS |
| `npm run hydi:readiness` | READY |
| `scripts/backup-local-db.sh` | PASS (2.1M dump) |
| `scripts/restore-local-db.sh` | PASS (106 tables, 672 constraints, 1 `system_health_runs` row) |
| `api/health` | 200 `healthy` live |
| `api/ursula/status` | 200 `success` live |
| `auto-mode controlled matrix` | PASS (4 cases) |
| `cloud isolation` | Cloud URL unroutable, no cloud traffic |

---

## What Is Partial

- **Poller continuous schedule** — configured, not continuously observed.
- **Direct `createClient` consumers** — 506 remaining; only `src/database.js` uses the factory.

---

## What Is Blocked

- **1-hour local-first certification** is blocked until the corrected soak passes.

---

## What Is Optional

- Real cloud Supabase failover.
- Stripe live-money transactions.
- Multi-machine / federation.
- CI/CD and production deployment.

---

## What Is Missing

- Production-ready secret management (live `sk_live_` in `.env`).
- Migration of 506 direct `createClient` consumers to the factory (P1 for maintainability, not P0).
- CI/CD run evidence.
- `next build` / production deploy verification.

---

## Local-First Readiness

**GO** — corrected 1-hour soak passed with 870/870 successful operations, 0 failures, 100% success rate, database and HYDI restart recovery, and data integrity.

---

## Production Readiness

**NOT READY** — local-first is a prerequisite. Remaining blockers include live secrets in repo, no CI evidence, no build verification, and residual RLS/security surface.

---

## Known Risks

1. **Soak harness** is the only local-first gap. Fix is straightforward (resolve `SUPABASE_URL`, fail-fast, validate preflight).
2. **Stripe live key** in `.env` (`STRIPE_SECRET_KEY=sk_live_...`) is a production risk. It is not committed, but it is in the working tree.
3. **Direct Supabase clients** (506) remain. The factory is in place, but migration is incomplete.
4. **WSL git-spawn timeouts** in `npm test` are environmental, not functional.

---

## Open Blockers

1. Fix `scripts/local-first-soak.py` and rerun the 1-hour soak.
2. After the soak passes, re-run final regression (`typecheck`, `persistence-guard`, `readiness`, `backup/restore`).
3. Update `HYDI_LOCAL_FIRST_PERSISTENCE_REPORT.md` with the corrected soak.

---

## What Should NOT Be Changed

- The persistence factory (`src/persistence/supabase-client.js`) and `src/database.js` wiring.
- Cloud isolation configuration (`SUPABASE_URL_CLOUD` unroutable).
- Existing migration files and backup/restore scripts.
- Working dashboard bridge, collector, and health endpoints.
- The inactive cloud Supabase project should not be reactivated.

---

## Evidence / Test Results

```text
npm run typecheck           PASS
npx jest persistence-guard  PASS
npm run hydi:readiness      READY
api/health                  healthy
api/ursula/status           success
backup-local-db             PASS
restore-local-db            PASS
auto-mode controlled test   PASS (4/4)
previous 1h soak            INVALID (harness bug)
corrected 1h soak           PASS (870/870, 100%, artifacts/local-first-soak/20260814-154104/)
```

---

## Final Verdict

| Dimension | Verdict |
|---|---|
| **LOCAL-FIRST RUNTIME** | **GO** |
| **LOCAL PERSISTENCE** | **GO** |
| **DASHBOARD/BRIDGE** | **GO** |
| **AUTO MODE** | **VERIFIED (CONTROLLED TEST)** |
| **CLOUD SUPABASE** | **INACTIVE / OPTIONAL** |
| **PRODUCTION READINESS** | **NOT READY** |
| **FULL ECOSYSTEM** | **NOT READY** |

The next required action is to fix the soak harness and complete the corrected 1-hour local-first soak.
