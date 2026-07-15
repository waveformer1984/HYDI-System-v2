# HYDI V3 Reliability & Autonomy Layer

This package (`src/hydi-v3`) implements the HYDI V3 upgrade for the HYDI System.
It adds a full autonomy, reliability, and observability layer around the existing
V2 core without redesigning the architecture.

## Modules

| File | Purpose |
|------|---------|
| `AutonomyManager.js` | Central orchestrator that wires all V3 services and patches the core loop |
| `WatchdogSupervisor.js` | Phase 1: monitors agents for dead loops, blocked promises, heartbeat timeout, high resource usage |
| `HeartbeatSystem.js` | Phase 1: publishes and monitors per-service heartbeats |
| `GracefulShutdown.js` | Phase 1: intercepts signals and uncaught errors, runs flush handlers before exit |
| `DecisionIntelligence.js` | Phase 2: validates decisions, maintains searchable history, scores risk/expected value |
| `MissionPlanner.js` | Phase 3: mission-based planning with objectives, tasks, dependencies, priority, deadlines, replanning |
| `ReflectionEngine.js` | Phase 4: generates mission reflections and ranks strategies by category |
| `SelfHealingEngine.js` | Phase 5: detects symptoms, diagnoses recovery actions, retries with exponential backoff, escalates |
| `DistributedCompute.js` | Phase 6: node registry, heartbeat, scheduling, and work redistribution on failure |
| `MemoryIntegrity.js` | Phase 7: verifies memory stores for duplicate IDs, corrupted maps, orphan records, timestamps |
| `ObservabilityDashboard.js` | Phase 8: aggregates health, mission, revenue, queue, and decision metrics into dashboards and Prometheus export |
| `SecurityAuditor.js` | Phase 9: scans code for secrets, validates input, provides encryption helpers |
| `TestingFramework.js` | Phase 10: long-running, crash, power-loss, DB, network, queue, mission, reflection, distributed, and memory serialization tests |
| `PerformanceBenchmark.js` | Phase 11: benchmarks startup, mission planning, queue latency, DB, memory, reflection, task dispatch |
| `CheckpointStore.js` | Persists execution state for graceful shutdown and power-loss recovery |

## Integration

`HYDISystem.js` (V2 system) now imports `HYDIAutonomyManager` and starts it in
`start()`. The autonomy manager patches `coreLoop.getPendingTasks()` and
core-loop `takeAction()` so the V3 mission planner and decision intelligence are
used automatically. `shutdown()` stops the autonomy layer and persists state.

## Usage

```js
const HYDIAutonomyManager = require('./src/hydi-v3');

const manager = new HYDIAutonomyManager({
  coreLoop,
  orchestrator,
  memorySystem,
  actionLayer,
  modelStack,
  config: {
    enableGracefulShutdown: false,
    enableMissionPlanning: true,
    enableDecisionIntelligence: true,
    enableReflection: true,
    enableSelfHealing: true,
    enableMemoryIntegrity: true,
    enableObservability: true,
    enableSecurity: true,
  }
});

await manager.start();
const missionId = await manager.createMission('launch', 'Launch new feature');
// ... add objectives/tasks via manager.missionPlanner
await manager.stop();
```

## Scripts

- `npm run test` — unit tests
- `npm run test:integration:hydi-v3` — HYDI V3 integration tests
- `npm run test:soak:hydi-v3` — long-running stability simulation
- `npm run benchmark:performance` — performance benchmarks
- `npm run security-audit` — static security audit of new modules
- `npm run lint:hydi-v3` — lint V3 code and scripts
- `npm run typecheck:hydi-v3` — typecheck V3 code and scripts

## Data

The layer persists state under `data/` (or `config.dataPath`):

- `data/missions/missions.json`
- `data/decisions/decision_history.json`
- `data/reflections/reflections.json`
- `data/checkpoints/latest.json`
