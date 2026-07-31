# Phase 18C — Physical Operations Sensor Framework (Manufacturing Intelligence)

Date: 2026-07-26
Branch: clean-main
Builds on: Phase 18B (`BusinessEventBus` + `BusinessSignalInterpreter`)

## Implementation Summary

Phase 18B established `BusinessEventBus` as the single integration boundary for HYDI's real-world sensing layer. This phase proves the boundary by attaching a second, very different kind of sensor: manufacturing equipment. ProtoForge's physical assets — starting with the Creality K1 SE 3D printer — now generate business signals through exactly the same path filesystem and git events already use.

**`ExecutiveOperatingSystem` required no changes to support manufacturing.** A regression test asserts its source contains no `printer`, `Creality`, `OctoPrint`, `Moonraker`, `Klipper`, or `filament` references. The Executive OS consumes only `BusinessSignal` events, so the details of printers, CNC machines, laser cutters, and music hardware stay out of the COO layer.

## Architecture

```
PrinterSensor ──▶ BusinessEventBus ──▶ ManufacturingSignalInterpreter ──▶ BusinessSignal
                                                                    │
                                                                    ▼
EquipmentRegistry       ObservabilityDashboard ◀── BusinessMemory ◀── ExecutiveOperatingSystem
```

Four layers, four separate concerns:

- **EquipmentRegistry** knows the catalog of ProtoForge machines: identity, type, location, capabilities, and strategic objective. It is pure data and contains no business logic.
- **PrinterSensor** knows 3D-printer hardware only. It reports facts: the printer started, paused, completed, failed, is heating, or that material is low. It has a `simulate` mode and a pluggable `adapter` interface for future real integrations.
- **ManufacturingSignalInterpreter** owns all manufacturing business semantics. It turns `PrinterCompleted` into a positive `manufacturing` signal, `PrinterFailed` into an elevated-risk signal with a recommendation, and `MaterialLow` into a high-priority signal.
- **ExecutiveOperatingSystem** subscribes only to `BusinessSignal` and is unaware any printer exists.

## Files Added

- `src/hydi-v3/EquipmentRegistry.js` — mock catalog of ProtoForge equipment.
- `src/hydi-v3/EquipmentSensor.js` — base sensor class with lifecycle and bus emission helpers.
- `src/hydi-v3/PrinterSensor.js` — hardware-only printer sensor with simulation and adapter interface.
- `src/hydi-v3/ManufacturingSignalInterpreter.js` — translator from printer events to business signals.
- `tests/unit/hydi-v3/EquipmentSensor.test.js`
- `tests/unit/hydi-v3/PrinterSensor.test.js`
- `tests/unit/hydi-v3/ManufacturingSignalInterpreter.test.js`

## Files Modified

- `src/hydi-v3/BusinessSignalInterpreter.js` — the generic interpreter now returns `null` for unknown event types instead of emitting a generic "Activity" fallback. This prevents it from double-translating printer events that the manufacturing interpreter already handles, without the generic interpreter learning anything about printers.
- `src/hydi-v3/ObservabilityDashboard.js` — added `attachBusinessEventBus`, `recordBusinessSignal`, `getManufacturingStatus`, and `manufacturingStatus` in `getDashboard`. The dashboard consumes `BusinessSignal` events only.
- `src/hydi-v3/OperatorSession.js` — constructs `ManufacturingSignalInterpreter`, attaches `PrinterSensor` when `--simulate-manufacturing` or a `printer` config is supplied, and tears down the interpreter before the bus is destroyed.
- `src/hydi-v3/index.js` — exports `EquipmentRegistry`, `EquipmentSensor`, `PrinterSensor`, and `ManufacturingSignalInterpreter`.
- `scripts/operator-cli.js` — added `--simulate-manufacturing` flag.
- `tests/unit/hydi-v3/ExecutiveOperatingSystem.test.js` — added regression test asserting the Executive OS source contains no printer-specific terms.

## Event Types

| Hardware event | Business interpretation | Impact / priority |
|---|---|---|
| `PrinterStarted` | `<name> started a build` | `manufacturing-active` |
| `PrinterPaused` | `<name> paused a build` | `manufacturing-paused` |
| `PrinterResumed` | `<name> resumed a build` | `manufacturing-active` |
| `PrinterCompleted` | `<name> completed a build` | `positive`, confidence 0.98 |
| `PrinterFailed` | `<name> failed a build` | `risk-elevated`, recommendation to investigate |
| `PrinterIdle` | `<name> is idle and available` | `manufacturing-idle` |
| `PrinterHeating` | `<name> is heating up` | `manufacturing-warming` |
| `MaterialLow` | `Material inventory is low for <material>` | `risk-material`, priority `high` |

## Design Decisions

**Hardware facts only, no business meaning in sensors.** `PrinterSensor` never constructs recommendations, risk labels, or strategic objectives. It emits temperature, progress, materialRemaining, and status transitions. The `EquipmentSensor` base class makes the same contract trivial for future CNC, laser, and music sensors.

**Adapter interface for real integrations.** `PrinterSensor` accepts an `adapter` object with `fetchState(equipmentId)`. A future OctoPrint, Moonraker, or Klipper adapter can be dropped in without touching the sensor's event logic or the Executive OS.

**Startup publishes current state, never history.** On `start()`, `PrinterSensor` emits `PrinterIdle` and `MaterialLow` if material is below threshold — these are facts about the present. The simulation sequences are not replays; they are generated once on demand. The adapter's first poll sets a baseline before emitting transitions, so a long printer history is never replayed as fresh activity.

**Edge-triggered, state-aware simulation.** The `normal` and `failure` simulation scenarios emit each event exactly once. A steady printer produces zero new events, so the briefing is not flooded with repetition.

**Simulation is opt-in.** `--simulate-manufacturing` or an explicit `printer` config is required; no sensor observes the physical world by default. Sensors are torn down first in `_components()`, so a poll in flight cannot publish into a half-destroyed stack.

**Dashboard consumes BusinessSignals only.** `ObservabilityDashboard` does not import any sensor. It records `BusinessSignal` payloads that carry `strategicObjective: 'manufacturing'` and tracks `runningJobs`, `idleMachines`, `offlineMachines`, `failedJobs`, `materialAlerts`, and `recentActivity`.

## Self-Audit Results

- `ExecutiveOperatingSystem` source contains no `printer`, `Creality`, `OctoPrint`, `Moonraker`, `Klipper`, or `filament` terms (asserted by test).
- `BusinessMemory` and `ExecutiveAgents` contain no printer-specific logic.
- `ManufacturingSignalInterpreter` owns all manufacturing business semantics.
- `PrinterSensor` and `EquipmentSensor` emit only factual observations.
- Startup publishes current state (`PrinterIdle`, `MaterialLow`) but does not replay historical events.
- Simulation mode exercises all eight printer hardware event types.
- `ObservabilityDashboard` derives `manufacturingStatus` from `BusinessSignal` events, not hardware APIs.
- All new modules implement `start()`, `stop()`, and `destroy()` and clear timers, listeners, and references.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | pass, 0 errors |
| `npm run typecheck:hydi-v3` | pass, 0 errors |
| `npm run lint:hydi-v3` | pass, 0 errors (14 pre-existing `no-console` warnings) |
| `EquipmentSensor.test.js` | pass, 3/3 |
| `PrinterSensor.test.js` | pass, 6/6 |
| `ManufacturingSignalInterpreter.test.js` | pass, 6/6 |
| `ExecutiveOperatingSystem.test.js` regression | pass, 13/13 including no printer code |
| `npm test` (full suite) | 186/186 suites, 1909/1909 tests pass |
| `npm run benchmark:performance` | pass |

## Operator Reference

```bash
node scripts/operator-cli.js --simulate-manufacturing
node scripts/operator-cli.js --simulate-manufacturing --once "manufacturing status"
```

Without the flag, no printer sensor starts and the bus simply carries no manufacturing events.

## Next Recommended Milestone

A third sensor shape — one that is pull-based against an external cloud or inventory API — would further stress the bus boundary. The obvious candidates are a Stripe sensor for revenue signals or an inventory/ERP sensor for material replenishment, both of which would follow the same `Sensor → Bus → Interpreter → BusinessSignal` contract.
