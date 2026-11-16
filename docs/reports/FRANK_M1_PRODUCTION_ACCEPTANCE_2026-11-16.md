# Mission M1 — Frank Verified Production Closure

**Date:** 2026-11-16T02:20:00Z  
**Target branch:** `clean-main`  
**Expected baseline:** `1a86a7ee` (verified ancestor of current `clean-main`)  
**Auditor environment:** Cursor cloud agent VM (**not Frank**)

## Acceptance decision: **BLOCKED**

Frank-side phases **1–5 were not executed** from this environment. Cloud cannot reach `heidi-pc.tailc50af2.ts.net` (curl exit 6). **Do not treat this document as FRANK_VERIFIED production acceptance** until the operator completes the Frank runbook below and attaches evidence.

---

## What was verified without Frank

| Item | Result | Level |
|------|--------|-------|
| `clean-main` contains `1a86a7ee` | Yes | GitHub fetch |
| PRs #601, #602, #603 merged | Yes | GitHub API |
| Existing collector script | `scripts/frank-production-truth-collect.ps1` | Repo |
| Cloud supervisor/dashboard | `live_probe_rollup: UNAVAILABLE`, `frank_truth: UNAVAILABLE` | Cloud local |
| Proof-label bug | `frank: false` was hardcoded in bounded loop | **Fixed on branch** (see below) |

---

## Phase 1–5 (Frank) — **NOT RUN** — operator runbook

Run on **`C:\Users\Owner\HYDI-System-v2`** (DESKTOP-I719OIN). **Preserve uncommitted work** — use `git status` before pull.

**Preferred:** `scripts/frank-align-clean-main.ps1` (see `docs/reports/FRANK_CLOUD_TO_PRODUCTION_HANDOFF.md`).

```powershell
$ts = (Get-Date).ToUniversalTime().ToString("o")
$Accept = ".runtime\acceptance\m1-$ts"
New-Item -ItemType Directory -Force -Path $Accept | Out-Null

cd C:\Users\Owner\HYDI-System-v2
git status -sb | Tee-Object "$Accept\git-status.txt"
git fetch origin
git rev-parse HEAD | Tee-Object "$Accept\git-head.txt"
git merge-base --is-ancestor 1a86a7ee HEAD; if ($LASTEXITCODE -ne 0) { throw "HEAD is not a descendant of 1a86a7ee" }
git pull origin clean-main

# Phase 2 — production truth
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/frank-production-truth-collect.ps1 `
  2>&1 | Tee-Object "$Accept\collector.log"
$global:LASTEXITCODE | Tee-Object "$Accept\collector-exit.txt"
Get-ChildItem .runtime\production-truth\frank-production-truth-*.json |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 |
  Tee-Object "$Accept\collector-json-path.txt"

# Phase 3
npm run runtime:audit 2>&1 | Tee-Object "$Accept\runtime-audit.log"
node scripts/heidi-self-improve.js dashboard 2>&1 | Tee-Object "$Accept\dashboard.json"

# Phase 4 — local-ci (root cause: ESLINT_USE_FLAT_CONFIG in parent/PM2 env)
# local-ci.js strips it in ciChildEnv() for child processes — verify log line:
$env:ESLINT_USE_FLAT_CONFIG = "true"
node scripts/local-ci.js HEAD 2>&1 | Tee-Object "$Accept\local-ci.log"

# Phase 5 — ONLY with explicit owner authorization (not cloud agent)
# node scripts/heidi-self-improve.js run --owner-requested --force-new
```

**Evidence to return:** ZIP or paths under `$Accept`, plus tail of `.runtime\self-improvement\missions.jsonl`.

---

## Phase 4 — local CI root cause (codebase analysis)

| Observation | Detail |
|-------------|--------|
| Frank `local-ci/unit-tests` failed | Description: `npm run lint` on DESKTOP-I719OIN (commit `1a86a7ee`) |
| `local-ci/typecheck` | **Passed** on same host |
| Cloud VM `npm run lint` | Exit **0** (warnings only) |
| Documented cause | `ESLINT_USE_FLAT_CONFIG=true` in parent/PM2 env breaks legacy `.eslintrc.json` lint (`scripts/local-ci.js` `ciChildEnv()` **deletes** this var for **child** processes) |
| If lint still fails on Frank after child unset | Check PM2 `hydi-local-ci` env, user/system `ESLINT_USE_FLAT_CONFIG`, and read `local-ci/*.log` under `%TEMP%\hydi-local-ci\<sha>\` |

**Policy:** Do not suppress lint or skip checks. Fix env on Frank or remove persistent `ESLINT_USE_FLAT_CONFIG` from PM2/user env (see `docs/reports/FRANK_OPERATIONAL_VERIFICATION.md`).

---

## Smallest code correction (proof labels)

**Problem:** Even after a successful Frank collector run, bounded missions recorded `proof_label` with `frank: false` hardcoded — **could never reach `FRANK_VERIFIED`**.

**Fix (feature branch, not on `clean-main` yet):** `lib/heidi/self-improvement/frank-context.js` — `frankLiveTruthEligible()` uses existing `loadLatestFrankProductionTruth()` (`availability === 'LIVE'`). Wired into `bounded-self-improvement-loop.js` and `heidi-self-improve.js dashboard`.

**Branch:** `Cusor_agent01frank-m1-proof-wiring-7718`  
**Merge on Frank after pull** before Phase 5 if you want missions to record `FRANK_VERIFIED` when collector is fresh.

---

## Phase 5 — authorization

The cloud agent **did not** run `heidi-self-improve.js run --owner-requested` on Frank. Owner must authorize explicitly on the machine.

Success criteria when run on Frank **after** fresh collector + proof wiring:

- `missions.jsonl` row with `proof_label: FRANK_VERIFIED` (not `SIMULATED`)
- `verify` step evidence matches supervisor (`treat_status_degraded` / probe failures as designed for live-probe gap)
- No manual edits to history files

---

## Remaining blockers

1. **Operator execution** of Phases 1–4 on Frank (this document’s runbook).
2. **Merge** proof-wiring PR (if not yet on Frank’s tree).
3. **Owner-authorized** bounded mission (Phase 5).
4. **local-ci green** on Frank HEAD (lint env).

---

## Phase 7 — next decision

| M1 outcome | Next step |
|------------|-----------|
| **If Frank runbook + mission succeed** | **M2:** Unify mobile `/api/mobile-status` and improvement dashboard probe semantics (same rollup rules). |
| **If collector fails or probes empty** | Fix PM2/services first; do not expand autonomy. |
| **If local-ci lint fails with child env fix** | Remove `ESLINT_USE_FLAT_CONFIG` from PM2 `hydi-local-ci` parent environment. |

---

## Status labels (honest)

| Label | Value |
|-------|--------|
| **FRANK_VERIFIED** | **NO** (Frank phases not executed by this agent) |
| **PARTIAL** | **YES** — baseline verified; proof-label wiring prepared |
| **BLOCKED** | **YES** — requires Frank operator session |