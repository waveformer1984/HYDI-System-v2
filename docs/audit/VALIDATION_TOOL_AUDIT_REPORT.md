# Validation Tool Audit Report

**Date:** 2026-08-02
**Branch:** `release/v0.9.0`
**Baseline commit:** `23f8b48` (*feat: add operational qualification harness*)
**Scope:** Every production validation command, script, and the documentation describing them.

Classifications used throughout: **VERIFIED** (measured directly), **OBSERVED**,
**INFERRED**, **PENDING**, **NOT TESTED**.

---

## 1. Executive Summary

Six defects were found in which a validation tool did not measure what its name
or documentation claimed. Two were severe:

1. `npm run soak-test` executed a ~280 ms Jest unit test, not the 24-hour
   endurance script. Six release documents recorded that unit test as soak
   evidence.
2. The operational qualification harness had **never executed successfully** —
   it aborted on the first service on every invocation — and its failure
   injection was fabricated, hardcoding `recovered: true` and
   `dataIntegrity: true`. Had the blocking defect been fixed without also
   fixing the injector, the harness would have certified resilience it never
   exercised.

All six are corrected. Regression coverage is in
`tests/unit/validation-tooling-integrity.test.js` (49 tests).

---

## 2. Findings

### F-1 — Duplicate `package.json` script keys (CRITICAL)

**Classification: VERIFIED.** Reproduced by parsing the raw file.

`scripts` defined `soak-test` at line 26 and again at line 92, and `leak-test`
at line 86 and again at line 93. JSON object parsing retains only the last
occurrence, so the first definition of each was dead:

| Command | Intended | Actually executed |
|---|---|---|
| `npm run soak-test` | `node scripts/soak-test.js` (24 h) | `jest RC2Hardening.test.js -t "Soak harness"` (~280 ms) |
| `npm run leak-test` | `ProductionReliability` → "Resource leak detector" | `RC2Hardening` → "Resource auditor" |

Evidence:
```
duplicate script keys: [ 'soak-test', 'leak-test' ]
  effective "soak-test" => npx jest tests/unit/hydi-v3/RC2Hardening.test.js --testNamePattern="Soak harness" --runInBand
  effective "leak-test" => npx jest tests/unit/hydi-v3/RC2Hardening.test.js --testNamePattern="Resource auditor" --runInBand
```

Compounding this, `soak-test:1h` *did* correctly invoke `scripts/soak-test.js`.
So `soak-test` and `soak-test:1h` ran two entirely different implementations —
the exact "silently invokes a different implementation" failure mode.

**Resolution:** duplicates removed; the ambiguous names retired entirely (see §3).

---

### F-2 — Operational qualification harness could not run (CRITICAL)

**Classification: VERIFIED.** Reproduced by execution.

`orchestrator/stack-orchestrator.js:152` declared `const process = spawn(...)`
while referencing `process.cwd()` and `process.env` inside that same
initialiser. The `const` binding shadows the global `process` for the whole
function scope, so those references hit the temporal dead zone:

```
[Harness] Phase 1: Stack Lifecycle
[Orchestrator] Starting service: memory-engine
ReferenceError: Cannot access 'process' before initialization
    at StackOrchestrator.startService (stack-orchestrator.js:154:17)
```

This threw on the first service of every invocation. The harness had therefore
never produced a single qualification report.

**Resolution:** local renamed to `child`. Regression-locked by a source
assertion that `const process =` never reappears.

---

### F-3 — Fabricated failure injection (CRITICAL)

**Classification: VERIFIED.** Confirmed by reading `failures/failure-injector.js`.

All four scenarios — `DatabaseFailureScenario`, `RedisFailureScenario`,
`ProcessCrashScenario`, `NetworkInterruptionScenario` — implemented:

- `inject()` → `await this.sleep(n)` with a `// Simulate` comment
- `waitForRecovery()` → `await this.sleep(n); return true;`
- `validateDataIntegrity()` → `return true;`

Nothing was terminated, restarted, or checked. `reports/report-generator.js`
graded three acceptance criteria (*All failure scenarios recover*,
*Recovery time < 5 minutes*, *Data integrity maintained*) directly from those
hardcoded values, so they would have reported 100% pass for work never done.

Additionally, injection was armed by `failures.*.enabled: true` in the shipped
config — i.e. **enabled by default**, with no `--chaos` gate.

**Resolution:** scenarios replaced with real injection delegated to
`scripts/lib/soak-chaos.js`; data integrity is now always `NOT TESTED`;
injection gated behind an explicit `--chaos` flag. See the Chaos Engineering
Design Report.

---

### F-4 — Harness config keys never matched the code

**Classification: VERIFIED.** Reproduced.

`qualification-config.json` uses kebab-case (`memory-storage`, `process-crash`,
`network-interruption`); the harness read camelCase (`config.memoryStorage`,
`config.processCrash`). Every camelCase lookup returned `undefined`, so
`config.memoryStorage.enabled` would throw `TypeError`.

```
config.workloads.memoryStorage = undefined
config.failures.processCrash   = undefined
actual workload keys: [ 'interval', 'conversation', 'memory-storage', ... ]
```

**Resolution:** harness reads the kebab-case keys the config actually defines;
regression test asserts config keys and code keys agree.

---

### F-5 — Every workload requested a malformed URL

**Classification: VERIFIED.** Reproduced.

Config supplies complete endpoints (`http://localhost:3000/api/chat`) but each
workload appended its own path again:

```
configured endpoint:  http://localhost:3000/api/chat
URL actually fetched: http://localhost:3000/api/chat/api/chat
```

All six workloads would have 404'd, and the driver would have recorded those as
genuine application failures.

**Resolution:** workloads use the configured endpoint verbatim.

---

### F-6 — Collaborators received the wrong config section

**Classification: VERIFIED.**

`new WorkloadDriver(config)`, `new MetricsCollector(config)` were passed the
*root* config, but read `this.config.interval` / `this.config.leakThreshold`,
which exist only under `config.workloads` / `config.metrics`. Every tuned value
silently fell back to a hardcoded default.

**Resolution:** each collaborator receives its own section.

---

### F-7 — Sequential workload and metrics phases

**Classification: VERIFIED.**

`runFull()` awaited workload execution for the full duration, *then* metrics
collection for the full duration. Consequences: a "24 hour" qualification took
48 hours, and metrics sampled an idle system after load had stopped.

**Resolution:** merged into `runLoadedWindow()`, running both concurrently.

---

### F-8 — Mutually exclusive acceptance criteria

**Classification: VERIFIED.**

`generateAcceptanceCriteria` graded *Stack starts successfully*
(`status === 'started'`) and *Stack stops gracefully* (`status === 'stopped'`)
from the **same** object. One was guaranteed to fail. Separately, the harness
never called `orchestrator.stop()` on the success path, so shutdown was never
exercised and `calculateTotalDuration()` always returned 0.

**Resolution:** startup and shutdown recorded separately; an explicit shutdown
phase added.

---

### F-9 — `calculatePhaseStatus` returned `pass` unconditionally

**Classification: VERIFIED.**

```js
calculatePhaseStatus(data) {
  if (!data || data.length === 0) return 'incomplete';
  return 'pass';   // regardless of contents
}
```

A workload phase consisting entirely of failures still reported `pass`.

**Resolution:** takes a predicate; a phase with no data is `not_executed`.

---

## 3. Command Inventory — After Remediation

No duplicate keys remain (asserted by test). Each command has exactly one purpose.

| Command | Runs | Purpose |
|---|---|---|
| `soak-test-24h` | `node scripts/soak-test.js` | 24 h endurance, chaos off |
| `soak-test-1h` | `node scripts/soak-test.js --duration 3600000` | 1 h endurance, chaos off |
| `soak-test-24h:chaos` | `node scripts/soak-test.js --chaos` | Endurance + real failure injection |
| `soak-harness-test` | `jest RC2Hardening -t "Soak harness"` | Unit test of soak-harness logic |
| `resource-leak-test` | `jest ProductionReliability -t "Resource leak detector"` | Unit test |
| `resource-auditor-test` | `jest RC2Hardening -t "Resource auditor"` | Unit test |
| `runtime-validation` | `node scripts/op-validation.js` | Runtime validation harness |
| `security-audit` | `node scripts/security-audit.js` | Static security audit |
| `operational-qualification` | `operational-qualification.js quick` | Quick OQ run |
| `production-certification` | `operational-qualification.js full` | Full OQ run |
| `validation-audit` | `jest validation-tooling-integrity.test.js` | Audits the validation tooling itself |
| `release-validation` | `typecheck && lint && test && validation-audit` | Aggregate static release gate |

### Backward compatibility

`soak-test` and `leak-test` were **not** retained as aliases. Both names were
the direct cause of F-1: each mapped to two implementations, and neither name
states which one it runs. Retaining them would preserve the ambiguity this work
exists to remove. A regression test fails the build if either is reintroduced.

---

## 4. Residual Findings — Not Remediated

| Item | Classification | Note |
|---|---|---|
| Four separate soak implementations exist (`scripts/soak-test.js`, `scripts/soak-test-v3.js`, `tests/soak-test-24h.js`, `SoakHarness` unit test) | OBSERVED | Not consolidated. Each is now documented with its distinct scope; `tests/soak-test-24h.js` is marked as superseded. |
| `tests/soak-test-24h.js` documented a `--duration-hours` flag that was never implemented | VERIFIED | Docstring corrected to describe the actual `TEST_DURATION` env var; code unchanged. |
| No CI workflow invokes any soak, chaos, or qualification command | VERIFIED | Unchanged. These require a live stack and a dedicated host; `release-validation` covers the static gate. |
| `production-readiness-score.js` scores on the *existence* of `soak-test.js` | OBSERVED | File-presence heuristic, not an execution check. Left as-is. |

---

## 5. Verification

| Check | Result |
|---|---|
| Duplicate script keys | 0 (was 2) |
| `npx eslint` on all changed JS | 0 errors, 0 warnings |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 248 suites, 2381 passed, 1 skipped |
| `npm run validation-audit` | PASS — 49 tests |
| `node scripts/soak-test.js --duration 12000` | PASS, report emitted, chaos correctly disabled |
| `node operational-qualification.js quick` | Phase 1 no longer throws (was `ReferenceError` on every run) |
