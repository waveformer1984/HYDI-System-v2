# Phase 18E — Interpreter Layer Coverage Audit

Date: 2026-07-25
Branch: clean-main
Builds on: Phase 18C Physical Operations Sensor Framework (`6485558`) and Phase 18D Git Sensor

## Why This Audit

Phase 18C introduced a second interpreter. Until then the mapping from sensor event types to `BusinessSignal`s was trivially verifiable: one interpreter, one switch statement. With two interpreters both subscribed to `*`, each deciding independently whether an event is its business, two failure modes become possible — and **both are silent**:

- **Dropped** — no interpreter handles a type. The event reaches the bus, nothing translates it, it never appears in a briefing, and nothing errors.
- **Double-translated** — two interpreters handle the same type. One physical occurrence becomes two signals, double-counting in the briefing, the activity ledger, and the audit trail.

Neither condition is detectable by reading either file. This phase measured the actual behaviour and made the contract enforced.

## Results

**Double-translation: none.** The two interpreters have disjoint type sets, and each returns `null` for the other's domain (asserted).

**Dropped: two event types, both real.**

| Type | Publisher | Consequence |
| --- | --- | --- |
| `PrinterOffline` | `PrinterSensor` | A printer becoming unreachable — arguably the most operationally significant hardware event — produced no business signal at all. |
| `DirectoryDeleted` | `FilesystemMonitor` | Directory removals were invisible. |

`DirectoryDeleted` is a **regression introduced by Phase 18C**. `BusinessSignalInterpreter._interpretation()` never had a `DirectoryDeleted` case, but before 18C its `default` branch returned a generic `Activity in <project>` string, so the event still produced a signal. Changing `default` to `return null` was correct — it is what prevents printer events being double-translated — but it converted every already-unhandled type from *generic-but-present* to *silently absent*. `DirectoryDeleted` was the one type that silently changed behaviour.

## Files Added

- `src/hydi-v3/SignalCoverage.js` — audits the interpreter layer.
- `tests/unit/hydi-v3/SignalCoverage.test.js` — 10 tests.

## Files Modified

- `src/hydi-v3/ManufacturingSignalInterpreter.js` — handles `PrinterOffline` (`risk-equipment-offline`, elevated risk, high priority, with a recommendation).
- `src/hydi-v3/BusinessSignalInterpreter.js` — handles `DirectoryDeleted`.
- `src/hydi-v3/OperatorSession.js` — collects interpreters into `this.interpreters`, runs the coverage audit at startup and logs any problem, exposes `signalCoverage` in `healthCheck()`, and detaches every interpreter on teardown rather than only the first.
- `src/hydi-v3/index.js` — exports `SignalCoverage`.
- `scripts/minitest.js` — added the `mock*Once` family so `PrinterSensor.test.js` runs under the harness.
- `reports/business-os/phase18c-git-sensor.md` → `phase18d-git-sensor.md` (numbering collision; manufacturing keeps 18C as the committed phase).

## How the Guard Works

`SignalCoverage.audit()` probes each interpreter with a synthetic event per known sensor type and records which interpreters returned a signal. It measures **actual behaviour**, not a declared list — a declaration could itself drift from the switch statement it claims to describe, which is precisely the class of bug being fixed.

Two tests enforce the contract:

1. **Coverage** — every sensor event type is handled by exactly one interpreter. Adding a sensor event type without an interpreter case fails here instead of vanishing at runtime.
2. **Inventory drift** — `SENSOR_EVENT_TYPES` is cross-checked against the `_emit(...)` calls in each sensor's source. Without this, the hand-maintained inventory could silently narrow what the audit covers, which would defeat test 1.

The audit also runs at session startup and is surfaced in `healthCheck()`, so drift is visible in operation and not only in CI.

## Design Note: Two Interpreters Is the Right Shape

Merging them into one would centralise the switch but couple filesystem, git, and hardware vocabulary in a single file, and every new sensor family would have to edit it. Keeping them separate preserves the property that made 18D cheap — a new domain adds a module rather than modifying an existing one. The risk was never the split itself; it was that the split had no coverage contract. It has one now.

The remaining sharp edge is that both interpreters subscribe to `*` and self-select. A third interpreter that is careless with its `default` branch could claim types belonging to another. Test 1 detects that as `DOUBLE`, which is why it asserts on both conditions rather than only on gaps.

## Self-Audit Results

- Coverage measured by probing real interpreters, not by reading declarations.
- Inventory cross-checked against sensor source, so the audit cannot silently shrink.
- Both dropped types fixed and individually asserted.
- Disjointness asserted in both directions — neither interpreter claims the other's domain.
- `BusinessSignal` is never re-interpreted by either interpreter (asserted), so publishing cannot loop back through the `*` subscriptions.
- An interpreter that throws counts as not handling the type, so a crash cannot masquerade as coverage.
- Teardown now detaches every interpreter; previously only `signalInterpreter` was detached, leaving the manufacturing interpreter subscribed to a destroyed bus.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.typecheck.json` | pass, 0 errors |
| `SignalCoverage.test.js` | 10/10 pass |
| Sensing suites | 59/59 pass — SignalCoverage, ManufacturingSignalInterpreter, BusinessSignalInterpreter, PrinterSensor, EquipmentSensor, GitSensor |
| Session + briefing suites | 58/58 pass — OperatorSession, ExecutiveOperatingSystem, BusinessEventBus, FilesystemMonitor, BriefingRenderer |
| Operator + gateway suites | 84/84 pass — OperatorMode, ExecutiveCockpit, BusinessMemory, ExecutionGateway, ObservabilityDashboard, localAccessGuard |
| Live: both sensor families in one session | `all 24 sensor event type(s) routed to exactly one interpreter`; `healthCheck().checks.signalCoverage` true |
| Live: `PrinterOffline` end-to-end | reaches the briefing as "Prusa MK4 is offline and unreachable" — previously produced nothing |
| Live: git + `--simulate-manufacturing` together | briefing shows 5 manufacturing and 2 operations signals, correctly attributed to separate objectives |

**Not run in this environment:** full `npm test` (186 suites) and `npm run lint:hydi-v3` — Jest's crawler and ESLint's plugin resolution stall on the mounted volume. `scripts/minitest.js` executed the real test files instead. Run both on the host before merge.

## Next Recommended Milestone

Unchanged from 18D: a Stripe/revenue sensor is the remaining untested direction — pull-based against an external system, and the first sensor needing network, so it must interact correctly with `--offline` rather than hang. With the coverage guard in place, adding it will now fail loudly if its event types have no interpreter, rather than publishing into the void.

Worth pairing with signal volume control: three sensor families already feed one briefing, and the simulated manufacturing run alone produced 5 signals in a few seconds. Dedup and per-objective prioritisation will matter before a fourth family lands.
