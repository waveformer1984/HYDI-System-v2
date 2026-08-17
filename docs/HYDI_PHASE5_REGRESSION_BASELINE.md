# HYDI Phase 5 — Regression Baseline

## Purpose

Compare the current `npm test` failure set against the previous documented baseline to determine whether the failures are the same, environment-induced, and unrelated to the Apex/Rezonate local slice.

## Method

- Previous full-run baseline documented in `HYDI_APEX_PHASE4_OPERATIONAL_READINESS_REPORT.md`.
- Re-ran `npm test` after Phase 4 commit `6bd0e23` without any new code changes.
- Also ran suspected-flaky suites individually to confirm behavior.

## Previous baseline (Phase 4 report)

```text
npm test  1820/1826 PASS
          6 failing tests in 7 unrelated pre-existing suites
          Suites: 7 failed
```

Listed failing suites from the previous full run:

- `tests/unit/no-hardcoded-secrets.test.js`
- `tests/unit/heidi-core-action-executor.test.js`
- `tests/unit/proto-yi-diagnostics.test.js`
- `tests/unit/hydi-v3/HardwareDiscovery.test.js`
- `tests/unit/goal-executor.test.js`
- `tests/unit/application-factory.test.js`
- `tests/unit/hydi-v3/DistributedCompute.test.js`

## Current baseline (Phase 5 re-run)

```text
npm test  1821/1826 PASS
          5 failing tests in 6 unrelated suites
          Suites: 6 failed
```

Failing suites in the current full run:

- `tests/unit/no-hardcoded-secrets.test.js`
- `tests/unit/heidi-core-action-executor.test.js`
- `tests/unit/proto-yi-diagnostics.test.js`
- `tests/unit/hydi-v3/HardwareDiscovery.test.js`
- `tests/unit/goal-executor.test.js`
- `tests/unit/hydi-v3/HeartbeatSystem.test.js`

## Comparison

| Failure | Previous | Current | Same root cause? |
|---|---|---|---|
| `no-hardcoded-secrets` | yes | yes | yes — `git ls-files` fails due to `fatal: detected dubious ownership` |
| `heidi-core-action-executor` | yes | yes | yes — `git` subcommand exits 128 due to dubious ownership |
| `proto-yi-diagnostics` | yes | yes | yes — `Proto YI` is reachable because the runtime detects a Flask dependency/endpoint; the test expects `reachable: false` |
| `HardwareDiscovery` | yes | yes | yes — no Intel GPU on this host; `gpus.length` is 0 |
| `goal-executor` | yes | yes | yes — `git status` returns non-zero due to dubious ownership |
| `application-factory` | yes | no | no longer present in this run; passes when run individually (timeout under full load) |
| `DistributedCompute` | yes | no | no longer present in this run; passes when run individually (timeout under full load) |
| `HeartbeatSystem` | no | yes | not truly new — passes when run individually (timeout under full load) |

## Evidence that the failures are not caused by Apex/Rezonate work

1. None of the failing test files are `lib/apex/*`, `lib/rezonate/*`, `pao-system/agents/execution/apex.agent.ts`, `pao-system/agents/execution/rezonate.agent.ts`, or `pao-system/core/heidi.controller.ts`.
2. The stack traces point to `git`, `@supabase/supabase-js`, `python/Flask` availability, and `hydi-v3` GPU/heartbeat timing — all external to the local Apex/Rezonate slice.
3. The `HeartbeatSystem` suite was run individually and passed, proving the failure is timing-dependent under full parallel load.
4. The `application-factory` and `DistributedCompute` suites that failed in the previous run passed in this run, proving the failures are non-deterministic and environment/timing-related.

## Conclusion

The 5–7 failing suites are stable in **cause** (dubious git ownership, missing/available local runtimes, and timeout flakiness) but not stable in **composition** from run to run. They are not caused by Phase 4 or Phase 5 changes. They are a noisy baseline that cannot be used to declare the local Apex/Rezonate slice broken. The reliable signals are the targeted test suites, which all pass:

- `npx jest tests/unit/apex-archive-acceptance.test.js` — 4/4 PASS
- `npx jest tests/unit/apex-phase3-lifecycle.test.js` — 8/8 PASS
- `npx jest tests/unit/apex-phase4-operational-acceptance.test.js` — 13/13 PASS
- `node --test protoforge-applications/rezonate/tests/*.test.js` — 128/128 PASS
