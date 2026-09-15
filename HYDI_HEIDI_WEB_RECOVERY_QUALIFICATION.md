# HEIDI-Web Recovery Qualification Report

**Date:** 2026-09-15
**Branch:** `clean-main`
**Fix commits:** `d9d6ae1` (watchdog stdout/stderr capture), `526e601` (circular dependency fix)
**Qualification artifact:** `HYDI_HEIDI_WEB_RECOVERY_QUALIFICATION.json`

---

## 1. Executive Status

**RECOVERY_PROVEN.** Heidi's governed recovery pipeline (`watchdog.js` → `hydi-recover.js` → `OperationalIntelligence.governedRecover()` → `ActionSelector` → `RecoveryEngine`) now detects, diagnoses, recovers, and verifies a killed `heidi-web` process autonomously, with no human intervention.

This closes an incident in which `heidi-web` was down continuously for **~23 hours** (`2026-09-14T19:10:45Z` → `2026-09-15T18:38:08Z`) despite the watchdog retrying recovery every ~30 seconds the entire time, with zero successful attempts.

## 2. Root Cause

`heidi-web`'s dependency graph (`lib/operational/DependencyGraphBuilder.ts`) listed `bridge` as a blocking dependency. `bridge`'s own health check (`HealthProvenanceChecker.checkBridge()`) probes `heidi-web`'s own port (`http://127.0.0.1:3000/api/chat`) — so `bridge` could never be `HEALTHY` while `heidi-web` was down, and `bridge` is not an independently restartable process (`RecoveryEngine.restartBridge()` throws by design when it isn't a `boot.config.json` module). Every recovery attempt hit `RECOVERY_DEPENDENCY_BLOCKED` before ever reaching `heidi-web`'s own `restart_process` action (`Attempts: 0` on every failure record) — a circular dependency, not a real precondition.

The decision string that revealed this (`GOVERNED RECOVERY REPORT ... Outcome: RECOVERY_DEPENDENCY_BLOCKED ... dependency 'bridge' is still down`) was previously invisible: `watchdog.js`'s `exec()` callback only logged `err.message`'s generic `Command failed: <cmd>` wrapper and discarded `stdout`/`stderr`, where `hydi-recover.js` actually prints this report.

## 3. Fixes Applied

| Commit | Change |
|---|---|
| `d9d6ae1` | `scripts/watchdog.js` — capture and log `stdout`/`stderr` from the `hydi-recover.js` `exec()` callback |
| `526e601` | `lib/operational/DependencyGraphBuilder.ts` — remove `bridge` from `heidi-web`'s implicit dependencies; clear `bridge`'s stale `dependents: ['heidi-web']` reverse edge |

Both verified against the real, running local system before and after commit — no source change was accepted on faith.

## 4. Natural Recovery (Observed, Unprompted)

Within 15 minutes of the fix landing, the next natural watchdog cycle recovered `heidi-web` on its own:

| Time (UTC) | Event |
|---|---|
| `18:37:57` | Watchdog delegates to RecoveryEngine |
| `18:38:08.439` | `RecoveryEngine.restartProcess` spawns `heidi-web`, writes first-ever lease |
| `18:38:33` | Port accepts connections (compiling) |
| `18:38:57` | `HTTP 200` — fully healthy |

## 5. Controlled Qualification Proof

Scenario `A2-heidi-web-kill` (`lib/operational/FailureInjector.ts`, pre-existing, documented, risk `R1`) was run via `node scripts/hydi-qualify.js --scenario=A2-heidi-web-kill` to reproduce the failure under a controlled, repeatable procedure rather than relying on a single naturally-occurring incident.

| Metric | Result |
|---|---|
| Injected | Killed real `heidi-web` process (PID 19804) on port 3000 |
| Detected | `ECONNREFUSED` → watchdog hysteresis `FAILURE_SUSPECTED` → `FAILURE_CONFIRMED` |
| Action selected | `restart_process` |
| Recovered | New PID, new lease written by `RecoveryEngine.restartProcess` at `19:43:37.727Z` |
| Verified | `HTTP 200` at `19:43:46Z` |
| **Total detect → recover → verify** | **83.2 seconds** (within the 120s scenario timeout) |
| Escalations | 0 |
| Recovery success rate | 100% |
| Overall verdict | `OPERATIONAL` |

Independently re-verified (not just the script's self-report): live `curl` to `/api/health` returned `HTTP 200`; port 3000 held by a new PID (`21456`, wrapping `npm run dev` PID `9636`) distinct from the pre-kill PID (`19804`) — a genuine respawn.

Full raw result: see `HYDI_HEIDI_WEB_RECOVERY_QUALIFICATION.json`.

## 6. Collateral Impact

- `protoforge-core`: unaffected throughout (`HTTP 200` before, during, and after)
- ProtoForge Scout: `restarts=0`, same PID, untouched — **incident remains CLOSED**
- No database mutation
- No other PM2 process restarted (only `hydi-watchdog`, once, explicitly authorized, to load the fix)

## 7. Regression

18 test suites / 203 tests run against the fix (13 unit suites covering `DependencyGraphBuilder`, watchdog, and the operational governance stack; 5 hermetic integration suites covering recovery flows) — **0 failures**.

## 8. Remaining Non-Blocking Issues

- `system_dashboard`'s rolling 20-run health trend still shows residual `WARNING`/`CRITICAL` entries dated during the outage window — self-clearing as new `OK` runs accumulate, not a functional defect.
- `checkBridge()` still reports `bridge` as `UNAVAILABLE` whenever `heidi-web` is briefly down (unchanged design, now non-blocking) — candidate for a future cleanup if `bridge`'s status is ever surfaced on a human-facing dashboard.

---

**Verdict: RECOVERY_PROVEN. HEIDI_INFRASTRUCTURE: FREEZE.**
