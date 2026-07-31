# Phase 18B — Business Signal Integration

Date: 2026-07-25
Branch: clean-main

## Goal

Give HYDI eyes **and** a brain. Phase 18A produced filesystem events and business signals. Phase 18B makes `ExecutiveOperatingSystem` consume those signals and update its world model automatically.

## What Changed

### `ExecutiveOperatingSystem` now subscribes to `BusinessEventBus`

- Constructor accepts `eventBus`, `executiveTimeline`, and `auditLedger`.
- `start()` attaches a `BusinessSignal` subscriber; `stop()`/`destroy()` detach cleanly.
- On every `BusinessSignal`:
  - Writes an `activity` entity into `BusinessMemory`.
  - Records the event in `ExecutiveTimeline` (if connected).
  - Appends to `AuditLedger` (if connected).
  - Emits `business-signal-processed`.

### `BusinessMemory` supports `activity` entities

- Added `activity` to `ENTITY_TYPES`.
- Added `activity` to `DataIntegrity.VALID_TYPES`.
- `find()` now supports `since` for time-window queries based on `createdAt`/`timestamp`.

### Morning Briefing now includes `Recent Activity`

- `ExecutiveOperatingSystem.morningBriefing()` computes a `recentActivity` summary from `BusinessMemory`.
- `BriefingRenderer.toSections()` renders a `recent-activity` section after `executive-summary`.
- `BriefingRenderer.test.js` updated to include the new section in the expected order.

### `recentActivitySummary()`

Aggregates activity signals by strategic objective and subsystem:

```text
3 activity signals for resonate.
  Audio Engine in Resonate: 2 events.
  UI in Resonate: 1 event.
```

Default window is the last 24 hours.

### `ConversationEngine` and `ExecutiveCockpit` answer "What changed today?"

- `ConversationEngine._whatChanged()` now uses `executiveOS.recentActivitySummary()` when available.
- `ExecutiveCockpit` gained `what-changed` command parsing and `whatChanged()` handler.
- If no executive OS is connected, both fall back to the previous `ExecutiveTimeline` behavior.

## Flow Example

```
FilesystemMonitor sees src/audio/engine.cpp modified
↓
BusinessEventBus emits FileModified
↓
BusinessSignalInterpreter emits BusinessSignal
  interpretation: "Resonate Audio Engine updated"
  objective: resonate
  subsystem: Audio Engine
↓
ExecutiveOperatingSystem._onBusinessSignal() records:
  - activity entity in BusinessMemory
  - timeline event
  - audit ledger entry
↓
morningBriefing() reports:
  "1 activity signal for resonate."
  "  Audio Engine in Resonate: 1 event."
↓
Operator asks "what changed today?"
↓
ConversationEngine returns the same summary
```

## Test Coverage

| Test file | New coverage |
|---|---|
| `tests/unit/hydi-v3/ExecutiveOperatingSystem.test.js` | `consumes BusinessSignal events and surfaces activity in briefings` |
| `tests/unit/hydi-v3/BriefingRenderer.test.js` | `recent-activity` section in expected order |
| `tests/unit/hydi-v3/ConversationEngine.test.js` | existing suite still passes with `what changed` wiring |
| `tests/unit/hydi-v3/ExecutiveCockpit.test.js` | existing suite still passes; `what-changed` command available |

## Validation

| Gate | Command | Result |
|---|---|---|
| Type validation | `npm run typecheck` | PASS |
| Lint validation | `npm run lint:hydi-v3` | PASS (0 errors) |
| Full regression suite | `npm test` | **PASS — 182/182 suites, 1,862/1,862 tests** |
| Performance validation | `npm run benchmark:performance` | PASS |

## Architecture Implications

The `BusinessEventBus` is now the single integration boundary. Future data providers — Git, printer telemetry, inventory, sales, customer conversations — become event publishers. `ExecutiveOperatingSystem` consumes `BusinessSignal` events and updates its world model without needing to know where the signal originated.

## Remaining Work

- `ExecutiveOperatingSystem` does not yet adjust strategic objective health scores based on activity volume. Add an `objectiveConfidence` recalculation next.
- `BusinessWorkflowEngine` and `AuditLedger` are listed as potential subscribers but are not yet explicitly wired. `AuditLedger` is already used in `_onBusinessSignal()` if provided; `BusinessWorkflowEngine` can subscribe to `BusinessSignal` events to trigger workflows.
- `StrategicObjectives.summarize()` could incorporate `activity` entity counts for dynamic health.
- `ConversationEngine` could answer "what changed in <objective>?" by filtering `recentActivitySummary`.

## Recommended Next Steps

1. **Phase 18C: Git Activity Provider** — publish Git events to the same `BusinessEventBus`.
2. **Phase 18D: Telemetry Providers** — 3D printer, inventory, sales, customer conversation.
3. **Phase 19: Executive Habits** — morning, midday, end-of-day, weekly, monthly routines that summarize business signals.

## Commit Status

Pending commit. Working tree contains `CHANGELOG.md` update and the new report.
