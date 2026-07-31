# HYDI Operational Test Map (Phase 23B)

This table maps every HYDI v3 operational / integration test to the capability it protects and flags the duplicates introduced by the Phase 22 and Phase 23 work.

| Capability | Existing test | Duplicate? | Keep? | Notes |
|---|---|---|---|---|
| Full executive day (git + filesystem + manufacturing + revenue + briefing) | `tests/integration/hydi-operational-demo.test.js` | Yes — superseded by `hydi-morning-executive-simulation.test.js` | Keep for now; supersede | Phase 22 demo tests cover the same four signals as the new 23B morning simulation, but do not close the `execution → audit → evidence` loop. |
| Full executive day with closed loop | `tests/integration/hydi-morning-executive-simulation.test.js` | No | **Keep** | New canonical end-to-end test; boots through `HYDIOperationalBoot.boot()`. |
| Missing sensor graceful boot | `tests/integration/hydi-operational-failure-modes.test.js` | Yes — same as `hydi-production-failure-modes.test.js` | Consolidate | Remove from the older file once the unique tests are preserved elsewhere. |
| Unknown event handling | `tests/integration/hydi-operational-failure-modes.test.js` | Yes — same as `hydi-production-failure-modes.test.js` | Consolidate | Covered by the newer production failure-mode suite. |
| Corrupt memory recovery | `tests/integration/hydi-operational-failure-modes.test.js` | Yes — same as `hydi-production-failure-modes.test.js` | Consolidate | Covered by the newer production failure-mode suite. |
| Simulated / dry-run execution | `tests/integration/hydi-operational-failure-modes.test.js` | Yes — same as `hydi-production-failure-modes.test.js` | Consolidate | Covered by the newer production failure-mode suite. |
| Rejected approval with audit | `tests/integration/hydi-operational-failure-modes.test.js` | No | **Keep** | Unique test not duplicated elsewhere. |
| No-evidence recommendation evaluation | `tests/integration/hydi-operational-failure-modes.test.js` | No | **Keep** | Unique test not duplicated elsewhere. |
| Missing sensor graceful boot | `tests/integration/hydi-production-failure-modes.test.js` | Yes | **Keep** | Newer canonical failure-mode suite, now boots through `HYDIOperationalBoot.boot()`. |
| Unknown event handling | `tests/integration/hydi-production-failure-modes.test.js` | Yes | **Keep** | Newer canonical failure-mode suite. |
| Bad evidence does not move confidence | `tests/integration/hydi-production-failure-modes.test.js` | No | **Keep** | Unique to the newer suite. |
| Dry-run no mutation | `tests/integration/hydi-production-failure-modes.test.js` | Yes | **Keep** | Newer canonical failure-mode suite. |
| Corrupt memory recovery | `tests/integration/hydi-production-failure-modes.test.js` | Yes | **Keep** | Newer canonical failure-mode suite. |
| Audit trail for executed action | `tests/integration/hydi-production-failure-modes.test.js` | No | **Keep** | Unique to the newer suite. |
| Production entry points use `HYDIOperationalBoot` | `tests/unit/hydi-v3/EntryPointGuard.test.js` | No | **Keep** | New 23B guard test. |
| Autonomy manager mission / reflection | `tests/integration/hydi-v3-integration.test.js` | No | **Keep** | Older HYDIAutonomyManager integration test, out of scope for the `OperatorSession` consolidation. |
| OperatorSession boot / briefing / ask | `tests/unit/hydi-v3/OperatorSession.test.js` | No | **Keep** | Unit-level coverage of the session itself; direct `new OperatorSession` is acceptable here. |
| Execution gateway approval / audit | `tests/unit/hydi-v3/ExecutionGateway.test.js` | No | **Keep** | Unit-level coverage. |
| Learning confidence calibration | `tests/unit/hydi-v3/ConfidenceCalibration.test.js` | No | **Keep** | Unit-level coverage. |

## Consolidation actions taken

1. `tests/integration/hydi-production-failure-modes.test.js` was updated to boot through `HYDIOperationalBoot.boot()` instead of `new OperatorSession(...)`.
2. `tests/integration/hydi-morning-executive-simulation.test.js` was added and also boots through `HYDIOperationalBoot.boot()`.
3. `tests/unit/hydi-v3/EntryPointGuard.test.js` was added to guard the production entry-point contract.
4. `tests/integration/hydi-operational-demo.test.js` and `tests/integration/hydi-operational-failure-modes.test.js` were left in place. They are Phase 22 deliverables and still contain direct `OperatorSession` construction; the map recommends either removing them or porting their unique tests (`rejected approval`, `no evidence`) into `hydi-production-failure-modes.test.js` once Phase 22 sign-off is complete.
