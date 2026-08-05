# Architecture Report

## Executive Summary

- **Circular dependencies in `src/server.js` graph:** None (`madge` processed 40 files)
- **Core module runtime load tests:** `kilo/index.js`, `lib/protoforge/policy-engine.js`, `src/hydi-v3/index.js`, `workers/WorkerOrchestrator.js` all `require` successfully.
- **Next.js API route caveat:** `api/chat/route.js` cannot be `require`d directly from Node; it is an ESM-style Next.js route that imports `lib/claude.ts`. TypeScript typecheck (`npm run typecheck`) resolves this import, so it is considered resolvable in the Next.js build pipeline.
- **No obvious duplicate implementations** in the key architectural subsystems inspected.
- **Dead-code / orphan-module scan:** Not exhaustive; 749 lint warnings for unused variables/args were recorded in `Validation_Report.md`.

## Key Subsystems Verified

| Subsystem | Entry point | Runtime `require` test | Result |
|-----------|-------------|-----------------------|--------|
| KILO hypothesis generator | `kilo/index.js` | `require('./kilo/index.js')` | PASS |
| ProtoForge policy engine | `lib/protoforge/policy-engine.js` | `require('./lib/protoforge/policy-engine.js')` | PASS |
| HYDI V3 executive runtime | `src/hydi-v3/index.js` | `require('./src/hydi-v3/index.js')` | PASS |
| Worker orchestration | `workers/WorkerOrchestrator.js` | `require('./workers/WorkerOrchestrator.js')` | PASS |
| Database bootstrap | `src/database.js` | `require('./src/database.js')` | PASS (after dotenv fix) |
| Next.js universal chat | `api/chat/route.js` | `require('./api/chat/route.js')` | Not applicable — Next.js ESM/TS route |

## Circular Dependency Analysis

- **Tool:** `madge@8.0.0`
- **Command:** `npx madge --circular --extensions js,ts,tsx src/server.js`
- **Result:**

```text
Processed 40 files (4.3s)
√ No circular dependency found!
```

This covers the core server bootstrap graph (`src/server.js` → `src/database.js`, `modules/`, `src/api/`, etc.). It does **not** cover the full `src/hydi-v3/` or `pao-system/` graphs individually.

## Next.js API Routes

### `api/chat/route.js`

- `node -e "require('./api/chat/route.js')"` fails with `ERR_MODULE_NOT_FOUND` for `lib/claude`.
- The file imports `lib/claude` (a TypeScript module, `lib/claude.ts`) and is intended to be transpiled by Next.js SWC, not loaded directly with Node's CJS `require`.
- `npm run typecheck` (tsc) passes, which is the strongest evidence that the import is resolvable in the project's type/compile model.
- **Conclusion:** Not a broken import for the Next.js production build, but it does mean the file cannot be unit-tested in isolation with plain `require`.

## HYDI V3 Module Surface

`src/hydi-v3/index.js` re-exports 70+ modules:

- `AutonomyManager` (default)
- `WatchdogSupervisor`, `HeartbeatSystem`, `GracefulShutdown`
- `DecisionIntelligence`, `MissionPlanner`, `ReflectionEngine`, `SelfHealingEngine`
- `ExecutiveOperatingSystem`, `ExecutiveCockpit`, `StrategicObjectives`, `BriefingRenderer`
- `OperatorSession`, `OperatorCLI`, `ConversationEngine`
- `BusinessEventBus`, `FilesystemMonitor`, `BusinessSignalInterpreter`
- `GitRepository`, `GitSensor`, `EquipmentRegistry`, `PrinterSensor`
- `OllamaAdapter`, `ModelProfile`, `LoadBalancer`, `ModelPlacementEngine`
- `FederationGateway`, `NodeDiscovery`, `NodeMesh`, `NodeScheduler`, `NodeTransport`
- `RevenueSensor` and adapters
- ... and more

The runtime `require` of `src/hydi-v3/index.js` succeeds, confirming the index and its dependencies can be resolved.

## Six-Layer Pipeline Adherence

Per `CLAUDE.md` / `AGENTS.md`:

| Layer | Location | Verified? |
|-------|----------|-----------|
| Ingestion | `api/` routes | Structure observed |
| RAW EVENT LEDGER | `heidi_events` table / ledger | Schema confirmed by migration tests |
| CASCADE | `cascade/`, `modules/cascade-complete-v2.js` | Module exists; not loaded independently |
| KILO | `kilo/index.js` | Runtime `require` PASS |
| ProtoForge | `lib/protoforge/policy-engine.js` | Runtime `require` PASS; fail-closed default observed |
| Emission | `api/events/stream.js`, SSE/WebSocket modules | Structure observed |

## Duplicate / Orphan Findings

| Item | Finding | Severity |
|------|---------|----------|
| `nnotification.service.ts` | Typo exists (`pao-system/services/nnotification.service.ts`) but `AGENTS.md` explicitly says not to rename until all imports are updated | Info — intentional hold |
| `apps/ursula-frontend` | Separate Next.js app with some duplicated UI patterns (e.g., `components/dashboard/*` vs root `components/`) | Low |
| `heidi-core/` | Legacy or embedded core directory; mostly ignored | Low |
| `data/`, `logs/`, `_diag/` | Runtime/generated data not source | Ignored |

No evidence was found of two competing implementations of KILO, ProtoForge, CASCADE, or the executive OS. `src/hydi-v3/` is the canonical V3 executive layer per `ACTIVE_TREE.md`.

## Warnings

1. **Full dead-code scan not performed.** 749 linter warnings for unused variables/arguments suggest there is cleanup debt, but no release-blocking circular or missing imports were detected.
2. **Next.js routes cannot be `require`d directly.** Any future attempt to unit-test `api/*.js` with plain `require` will fail; use `next dev` / `next build` / Jest with the correct test environment.
3. **Architecture diagrams not generated.** No diagram tooling was configured; this report is text-based.

## Commands Executed

```text
npx madge --circular --extensions js,ts,tsx src/server.js
node -e "require('./src/database.js'); require('./kilo/index.js'); require('./lib/protoforge/policy-engine.js');"
node -e "require('./src/hydi-v3/index.js');"
node -e "require('./workers/WorkerOrchestrator.js');"
node -e "require('./api/chat/route.js');"
```

## Conclusion

The core architecture is intact: no circular dependencies in the server bootstrap graph, key subsystems resolve and load, and the six-layer pipeline is reflected in the codebase. The only caveat is the Next.js ESM/TS route loading model, which is expected and not a production issue. Dead-code cleanup should follow the 749 lint warnings, but it is not a hard release blocker.
