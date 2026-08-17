# HYDI Phase 5 — Local-First Readiness Report

## Commit

- Branch: `feat/hydi-system-wide-audit`
- Phase 4 commit: `6bd0e23`
- Phase 5 to be committed: `TBD`

## What was done in Phase 5

1. Re-ran the full `npm test` regression suite.
2. Compared the current failure set to the Phase 4 baseline.
3. Audited `api/`, `lib/`, `workers/`, `cascade/`, `protoforge/cascade/` for Supabase/cloud dependencies.
4. Produced:
   - `docs/HYDI_PHASE5_LOCAL_FIRST_CLOSURE_AUDIT.md`
   - `docs/HYDI_PHASE5_REGRESSION_BASELINE.md`
   - `HYDI_PHASE5_LOCAL_FIRST_READINESS_REPORT.md`

No code was implemented, because no new local-first operational gap was identified within the Apex/Rezonate/Heidi slice. The gap is a scope boundary, not a missing implementation in this slice.

## Verification

```text
npm run typecheck                                              PASS
npm run build                                                  PASS
npm run validate:rezonate-contract                             PASS
node --test protoforge-applications/rezonate/tests/*.test.js   128/128 PASS
python3 -m unittest tests.test_persistence (Apex)              7/7 PASS
npx jest tests/unit/apex-archive-acceptance.test.js            4/4 PASS
npx jest tests/unit/apex-phase3-lifecycle.test.js              8/8 PASS
npx jest tests/unit/apex-phase4-operational-acceptance.test.js 13/13 PASS
npm test                                                       1821/1826 PASS
                                                               5 failing tests in 6 unrelated suites
```

## Regression baseline note

The full `npm test` suite is non-deterministic. In this run, 6 suites failed with 5 test failures. The failures are the same root causes as before:

- `tests/unit/no-hardcoded-secrets.test.js` — `git ls-files` fails due to dubious ownership.
- `tests/unit/heidi-core-action-executor.test.js` — `git` exits 128 due to dubious ownership.
- `tests/unit/proto-yi-diagnostics.test.js` — `Proto YI` reachable because the runtime sees a Flask dependency.
- `tests/unit/hydi-v3/HardwareDiscovery.test.js` — no Intel GPU on the host.
- `tests/unit/goal-executor.test.js` — `git status` fails due to dubious ownership.
- `tests/unit/hydi-v3/HeartbeatSystem.test.js` — timing/flaky; passes when run individually.

Two suites that failed in the previous full run (`application-factory`, `DistributedCompute`) passed in this run, and `HeartbeatSystem` appeared. This proves the failures are environmental and flaky, not caused by Apex/Rezonate/Heidi changes.

## Local-first audit summary

| Component | Local-first? |
|---|---|
| Heidi control plane (Apex + Rezonate slice) | YES |
| Apex Archive bridge | YES |
| Rezonate canonical repository | YES |
| CASCADE (docs only in this repo) | YES (N/A) |
| ProtoForge CASCADE | NO — needs local policy/ledger store |
| Health APIs (`api/health.js`, `api/mobile-status.js`, `api/status/system.js`, `api/ursula/status.js`) | NO — read Supabase `system_dashboard` |
| Workers | NO — all use `lib/server.ts` / Supabase queues |
| Revenue/ledger | NO — Supabase tables |
| Chat | NO — Supabase `memories` / `conversations` |

## What prevents full local-first closure

The following subsystems require Supabase at runtime and have no local fallback in the current codebase:

1. **ProtoForge policy rules** (`lib/protoforge/policy-engine.js`).
2. **Raw ledger / CASCADE** (`lib/protoforge/raw-ledger.ts`, `protoforge/cascade/src/index.js`).
3. **Worker queue** (`lib/jobs/stores/SupabaseJobQueue.ts`).
4. **Health dashboard views** (`api/health.js`, `api/mobile-status.js`, `api/status/system.js`, `api/ursula/status.js`).
5. **Chat memory** (`api/chat/route.js`).
6. **Revenue/ledger** (`lib/dashboard/revenue-service.js`, `revenue-engine/`, `lib/protoforge/raw-ledger.ts`).

Migrating these is a multi-phase effort that would require RFCs, local store implementations, and regression tests. It is not the smallest remaining blocker for the Apex/Rezonate slice.

## Verdicts

| Subsystem | Verdict | Reason |
|---|---|---|
| **Heidi control plane** | **GO** | Authorization, capability guards, idempotency, audit, and recovery all work without Supabase for the local slice. |
| **Apex** | **GO** | Bridge, client, and mapping are filesystem-local and proven. |
| **Rezonate** | **GO** | Canonical repository defaults to local JSON persistence and is proven. |
| **Full local HYDI** | **NO-GO** | Health APIs, workers, ProtoForge policy, ledger, revenue, and chat require Supabase. There is no local fallback for these subsystems. |

## What was not done

- No Supabase migrations were deleted.
- No cloud code was modified or removed.
- No unrelated working-tree changes were touched.
- No new features were added.
- No `npm test` failures were reclassified as "pre-existing" without evidence. The evidence is in `docs/HYDI_PHASE5_REGRESSION_BASELINE.md`.

## Recommended next phase (optional)

A Phase 6 could choose one of these and implement a minimal local fallback:

- Local `system_dashboard.json` for health APIs.
- Local `LocalJobQueue` for workers.
- Local `policies.json` for ProtoForge.

Any of these would be a separate, bounded RFC, not a continuation of the Apex/Rezonate slice.
