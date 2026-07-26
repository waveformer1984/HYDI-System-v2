# Phase 18A — Business Event Bus & Filesystem Monitor

Date: 2026-07-25
Branch: clean-main

## Goal

Stop building core architecture and start giving HYDI real-world sensory input. Phase 18A introduces the central `BusinessEventBus` and the first data provider: a `FilesystemMonitor` that turns local project activity into meaningful business signals.

## New Modules

### `src/hydi-v3/BusinessEventBus.js`

A typed pub/sub event bus with:

- `emit(type, payload, source)` — publish an event with auto-generated `id` and `at`.
- `subscribe(type, handler)` / `subscribeAll(handler)` — consumer registration.
- `unsubscribe(type, handler)` / `off` — cleanup.
- `getHistory(query)` — filter by type, source, since, limit.
- `replay(type, handler, limit)` — replay recent events into a late subscriber.
- `destroy()` — remove listeners and clear history.

The bus is intentionally logic-free. It only ensures reliable, ordered, typed delivery.

### `src/hydi-v3/FilesystemMonitor.js`

Watches configured project roots and emits filesystem events:

- `ProjectOpened`
- `FileCreated`
- `FileModified`
- `FileDeleted`
- `DirectoryCreated`
- `DirectoryDeleted`
- `ProjectActive`

Each event carries:

- `project` — the configured root name
- `root` — the absolute root path
- `path` — the absolute file path
- `relPath` — path relative to the root
- `size` / `mtime` (for files)

Features:

- Periodic polling scans every `scanIntervalMs`.
- Optional `fs.watch(..., { recursive: true })` on supported platforms to trigger immediate rescans.
- Default exclude patterns: `node_modules`, `.git`, `.next`, `dist`, `build`, `coverage`, `.env`.
- Snapshot-based diffing prevents duplicate events.
- Graceful fallback to polling-only if `fs.watch` fails.

### `src/hydi-v3/BusinessSignalInterpreter.js`

Subscribes to raw filesystem events and re-emits `BusinessSignal` events with meaning:

```json
{
  "interpretation": "Work in progress in Resonate",
  "strategicObjective": "resonate",
  "subsystem": "Audio Engine",
  "project": "Resonate",
  "fileCategory": "source",
  "confidence": "high",
  "impact": "engineering-progress"
}
```

Mapping defaults:

| Project keyword | Strategic objective |
|---|---|
| resonate / rezonate | `resonate` |
| protogrance / cad / manufacturing | `manufacturing` |
| research | `research` |
| music | `music` |
| protoforge | `operations` |

Subsystem detection uses path keywords (`audio`, `ui`, `cad`, `gcode`, `test`, `docs`, etc.) and file extension fallback.

## Integration

- `src/hydi-v3/index.js` now exports `BusinessEventBus`, `FilesystemMonitor`, and `BusinessSignalInterpreter`.
- Future providers (Git, telemetry, sales, inventory) will publish to the same `BusinessEventBus`.
- `ExecutiveOperatingSystem` can later subscribe to `BusinessSignal` events and write activity entities into `BusinessMemory`.

## Example Flow

```
FilesystemMonitor detects src/audio/engine.cpp modified
↓
BusinessEventBus emits FileModified
↓
BusinessSignalInterpreter emits BusinessSignal
  interpretation: "Work in progress in Resonate"
  strategicObjective: "resonate"
  subsystem: "Audio Engine"
↓
Future ExecutiveOperatingSystem uses this as evidence in the morning briefing
```

## Test Coverage

| Test file | Coverage |
|---|---|
| `tests/unit/hydi-v3/BusinessEventBus.test.js` | typed emit, wildcard, history, limit, replay |
| `tests/unit/hydi-v3/FilesystemMonitor.test.js` | ProjectOpened, FileCreated, FileModified, FileDeleted, exclude patterns |
| `tests/unit/hydi-v3/BusinessSignalInterpreter.test.js` | Resonate audio signal, manufacturing artifact, no-bus interpretation |

## Validation

| Gate | Command | Result |
|---|---|---|
| Type validation | `npm run typecheck` | PASS |
| Lint validation | `npm run lint:hydi-v3` | PASS (0 errors) |
| Full regression suite | `npm test` | **PASS — 182/182 suites, 1,861/1,861 tests** |
| Performance validation | `npm run benchmark:performance` | PASS |

## Usage Example

```js
const { BusinessEventBus, FilesystemMonitor, BusinessSignalInterpreter } = require('./src/hydi-v3');

const bus = new BusinessEventBus({ maxHistory: 5000 });
const monitor = new FilesystemMonitor({
  eventBus: bus,
  roots: { Resonate: 'C:/ProtoForge/Resonate', ProtoGrace: 'C:/ProtoForge/ProtoGrace' },
  scanIntervalMs: 30000,
});
const interpreter = new BusinessSignalInterpreter({ eventBus: bus });

bus.subscribe('BusinessSignal', (e) => console.log(e.payload));

await monitor.start();
```

## Remaining Work

- `BusinessSignalInterpreter` currently maps only filesystem events. Extend it to interpret Git events once `GitActivityProvider` is added.
- `ExecutiveOperatingSystem` does not yet consume `BusinessSignal` events. Wire them into `BusinessMemory` and morning briefing next.
- `FilesystemMonitor` does not yet emit `ProjectInactive` after idle thresholds; add `checkInactive()` and `inactiveThresholdMs`.
- Add `GitActivityProvider` (Phase 18B) reacting to branch, commit, test, and merge events.

## Commit Status

Pending commit. Working tree contains `CHANGELOG.md` update and the new report.
