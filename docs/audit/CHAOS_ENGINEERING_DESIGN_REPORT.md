# Chaos Engineering Design Report

**Date:** 2026-08-02
**Implementation:** `scripts/lib/soak-chaos.js`, consumed by `scripts/soak-test.js`
and `operational-qualification/failures/failure-injector.js`.

---

## 1. What Replaced What

The prior "failure injection" in `operational-qualification/failures/failure-injector.js`
consisted of four classes whose entire behaviour was:

```js
async inject()            { await this.sleep(5000); }        // "Simulate 5 second outage"
async waitForRecovery()   { await this.sleep(10000); return true; }
validateDataIntegrity()   { return true; }
```

No process was signalled, no container touched, no state compared. Because
`report-generator.js` derived *All failure scenarios recover*, *Recovery time
< 5 minutes*, and *Data integrity maintained* from these return values, the
harness was structurally incapable of reporting a resilience failure.

That code is deleted. A regression test asserts the classes and the
`return true` integrity stub cannot return.

---

## 2. Design Principles

1. **Disabled by default.** Injection is destructive. It happens only when
   `--chaos` is passed explicitly. No other flag, config key, or run mode
   enables it.
2. **Skipped is not passed.** A scenario that cannot apply its fault reports
   `status: 'skipped'` with a reason, and is classified `NOT TESTED`. It never
   contributes to a success rate.
3. **Confirm the fault landed.** Before crediting a recovery, the scenario
   verifies the target actually became unhealthy. If the health endpoint never
   went down, the result is `failed` with *"the fault did not take effect and no
   recovery was exercised"* — not a pass.
4. **Refuse to measure from a broken baseline.** If the target is already
   unhealthy before injection, the scenario skips rather than attributing a
   pre-existing outage's recovery to chaos.
5. **Never assert what is not measured.** Data integrity is always `null` with
   the note *"not verified: harness does not snapshot or diff durable state."*

---

## 3. Scenario Registry

`node scripts/soak-test.js --list-scenarios`

| Name | Fault | Recovery measured against |
|---|---|---|
| `restart-next` | Terminate PID(s) listening on the Next.js port | `http://localhost:3000/api/health` |
| `kill-bridge` | Terminate the Heidi Bridge process | `http://localhost:5050/health` |
| `restart-core` | Terminate the HYDI Core orchestrator | `http://localhost:9997/health` |
| `restart-memory-engine` | Terminate the Memory Engine | `http://localhost:9998/health` |
| `restart-redis` | `docker compose restart redis` | TCP connect on `REDIS_PORT` |
| `restart-postgres` | `docker compose restart postgres` | TCP connect on `PGPORT` |
| `restart-protohub` | `docker compose restart protohub-api` | `http://localhost:4000/health` |
| `delayed-postgres-startup` | Stop PostgreSQL, hold down, restart | Dependent `/api/health` recovery |

Process targets and health endpoints are read from `services-manifest.json`, so
the registry stays aligned with the real topology rather than duplicating it.

---

## 4. Scenario Lifecycle

```
1. Look up the service in services-manifest.json
   └─ absent, or no healthCheck? → SKIPPED (recovery would be unmeasurable)
2. Pre-flight health probe
   └─ already unhealthy? → SKIPPED (refuse a false baseline)
3. Resolve listening PIDs (netstat on Windows, lsof on POSIX)
   └─ none found? → SKIPPED (fault could not be injected)
4. Inject: taskkill /F /T  or  kill -9
5. Confirm outage within 15 s
   └─ never went unhealthy? → FAILED (fault did not land)
6. Restart from the manifest cmd, unless --supervised
7. Poll health until recovered or timeout (default 120 s)
8. Record: injectedAt, injectedFault, observedBehaviour, recoveryMs,
   outageDetectedAfterMs, recoveredBy, status
```

Every record carries the six required fields: **timestamp**, **injected fault**,
**recovery duration**, **observed behaviour**, **pass/fail**, and — where
applicable — the **reason** it was skipped.

Example of a recorded result:

```json
{
  "scenario": "restart-next",
  "status": "passed",
  "injectedAt": "2026-08-02T16:04:11.201Z",
  "injectedFault": "terminated PID(s) 24188 listening on port 3000",
  "observedBehaviour": "health endpoint went down after 812ms and returned healthy after 9430ms across 6 probes",
  "recoveryMs": 9430,
  "outageDetectedAfterMs": 812,
  "recoveredBy": "harness (manifest cmd)"
}
```

---

## 5. Invocation

```bash
# Endurance only. No fault injected. This is the default.
node scripts/soak-test.js

# Endurance + controlled resilience testing (destructive).
node scripts/soak-test.js --chaos

# A specific subset.
node scripts/soak-test.js --chaos --chaos-scenarios restart-next,kill-bridge

# Plan without injecting.
node scripts/soak-test.js --chaos --dry-run

# Supervisor performs recovery instead of the harness.
node scripts/soak-test.js --chaos --supervised

# Operational qualification with chaos.
node operational-qualification/operational-qualification.js full --chaos
```

Scenarios rotate on `--chaos-interval` (default 1 h) across the run.

---

## 6. Safety

| Control | Mechanism |
|---|---|
| Off by default | `parseArgs` sets `chaos: false`; four regression tests cover this |
| Config cannot arm it | `failures.*.enabled` selects *which* scenarios run, never *whether*; test asserts an all-enabled config still yields `failureInjector.enabled === false` |
| No accidental load | `soak-chaos.js` is `require`d lazily inside the `if (chaos)` branch; a test asserts no top-level require |
| Reversible faults only | Every scenario restarts what it stopped; no data is deleted and no volume is removed |
| Explicit blast radius | `--list-scenarios` marks every scenario `destructive` |
| CI guidance | OQ README states `--chaos` must not run on a shared runner |

**Per the operator's instruction, `--chaos` runs the full suite** — including
`restart-redis` and `restart-postgres` against the local Docker stack. This is
destructive to running containers, though not to persisted volumes. Use
`--chaos-scenarios` to narrow it.

---

## 7. Verification Status

| Item | Classification | Evidence |
|---|---|---|
| Chaos disabled by default | **VERIFIED** | 4 regression tests, incl. an all-enabled config yielding a disarmed injector |
| Chaos activates only on `--chaos` | **VERIFIED** | Regression test |
| Scenario registry loads and lists | **VERIFIED** | `--list-scenarios` executed, 8 scenarios printed |
| Skipped ≠ passed in statistics | **VERIFIED** | Regression test: `successRate` is `null`, not `1`, when nothing executed |
| Data integrity never asserted | **VERIFIED** | Regression test: `dataIntegrityRate` is `null` |
| Chaos-free run cannot report resilience pass | **VERIFIED** | Regression test on the report generator |
| **Scenarios executed against the live stack** | **NOT TESTED** | Not run. Executing destructive injection against the operator's live Redis/PostgreSQL requires their explicit go-ahead. |

The last row is the material gap. The mechanism is implemented, unit-tested and
safe by default, but **no scenario has yet been fired in anger**. Until a
`--chaos` run is performed and its report reviewed, HYDI's resilience properties
remain `NOT TESTED` — the tooling is now merely capable of testing them.
