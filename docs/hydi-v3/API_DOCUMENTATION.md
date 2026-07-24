# HYDI V3 API Documentation

This document describes the public interfaces of `HYDIAutonomyManager` and the key V3 modules.

## HYDIAutonomyManager

### Constructor

```js
new HYDIAutonomyManager({
  coreLoop,
  orchestrator,
  memorySystem,
  actionLayer,
  modelStack,
  config: { /* see Deployment Guide */ }
});
```

### Lifecycle

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Initialize all modules, restore checkpoint, patch core loop |
| `stop()` | `Promise<void>` | Persist state, stop timers, unpatch core loop |
| `destroy()` | `void` | Stop and clear all state (tests only) |

### Mission API

| Method | Returns | Description |
|--------|---------|-------------|
| `createMission(name, objective, options)` | `Promise<string>` | Create a mission and return its ID |
| `executeMission(missionId)` | `Promise<boolean>` | Plan the mission and mark tasks ready |

### Operational API

| Method | Returns | Description |
|--------|---------|-------------|
| `runSecurityAudit()` | `Promise<object>` | Run `SecurityAuditor.runAudit()` |
| `runMemoryIntegrity()` | `Promise<object>` | Run `MemoryIntegrity.runScan()` |
| `runPerformanceBenchmarks()` | `Promise<object>` | Run `PerformanceBenchmark.runAll()` |
| `runTestSuite()` | `Promise<object>` | Run `TestingFramework.runAll()` |
| `getStatus()` | `object` | Aggregate status of all modules |
| `getDashboard()` | `object` | Full observability dashboard |

### Direct Module Access

```js
manager.watchdog
manager.heartbeat
manager.gracefulShutdown
manager.decisionIntelligence
manager.missionPlanner
manager.reflectionEngine
manager.selfHealing
manager.distributedCompute
manager.memoryIntegrity
manager.observability
manager.securityAuditor
manager.testingFramework
manager.performanceBenchmark
manager.checkpointStore
```

## MissionPlanner

| Method | Returns | Description |
|--------|---------|-------------|
| `createMission(name, objective, options)` | `string` | Mission ID |
| `addObjective(missionId, objective)` | `string` | Objective ID |
| `addTask(missionId, task, options)` | `string` | Task ID |
| `planMission(missionId)` | `boolean` | Topological sort and set `ready` |
| `getNextTasks(capacity)` | `Array<object>` | Ready tasks sorted by priority/deadline |
| `startTask(taskId, missionId)` | `boolean` | Mark task running |
| `completeTask(taskId, missionId, result)` | `boolean` | Mark task completed |
| `failTask(taskId, missionId, error)` | `boolean` | Mark failed and trigger replanning |
| `pauseMission(missionId)` | `boolean` | |
| `resumeMission(missionId)` | `boolean` | |
| `cancelMission(missionId)` | `boolean` | |
| `archiveMission(missionId)` | `boolean` | |
| `getMission(missionId)` | `object` | Serialized mission |
| `getMissions(filters)` | `Array<object>` | Filtered mission list |
| `getStatus()` | `object` | Totals by status |

### Mission Object

```js
{
  id, name, objective, status, priority, deadline,
  createdAt, updatedAt, archivedAt,
  objectives: [],
  tasks: [],         // serialized Map
  revenue, failureCount, replanCount, progress
}
```

### Task Object

```js
{
  id, missionId, objectiveId, type, subtype, description, params,
  priority, deadline, dependencies: [], status, assignedAgent,
  createdAt, startedAt, completedAt, failedAt,
  retryCount, result, error
}
```

## DecisionIntelligence

| Method | Returns | Description |
|--------|---------|-------------|
| `makeDecision(input, context)` | `Promise<object>` | Build, validate, and return a decision |
| `recordOutcome(decisionId, outcome)` | `object` | Update decision with actual outcome |
| `recordDecision(task, decision, measurement)` | `object` | Convenience record from core loop |
| `searchHistory(filters)` | `Array<object>` | Filter by mission, agent, outcome, dates |
| `getDecisionById(id)` | `object` | |
| `getHistorySummary()` | `object` | total, success, failure, revenue, avgConfidence |
| `getStatus()` | `object` | |

### Decision Input

```js
{
  action,
  strategy,
  model,
  confidence,        // 0-1
  reason,
  evidence: [],
  expectedValue,
  riskScore,         // 0-1
  rollbackPlan,
  estimatedTimeMs,
  revenue,
  cost
}
```

### Context

```js
{
  task,
  resources: { cpu, memory },
  requiredCredentials: [],
  requiredPermissions: [],
  hasPermissions: boolean
}
```

## ReflectionEngine

| Method | Returns | Description |
|--------|---------|-------------|
| `reflectOnMission(mission)` | `Promise<object>` | Generate reflection for a completed mission |
| `getBestStrategy(category)` | `object` | Highest scoring strategy in category |
| `getWorstStrategy(category)` | `object` | Lowest scoring strategy in category |
| `getStrategyRankings(category)` | `Array<object>` | Sorted strategy scores |
| `getStatus()` | `object` | Reflections and rankings |

## SelfHealingEngine

| Method | Returns | Description |
|--------|---------|-------------|
| `heal(symptom, actions)` | `Promise<object>` | Diagnose and execute recovery plan |
| `diagnose(symptom)` | `object` | `{ action, target }` |
| `getStatus()` | `object` | Active attempts and escalations |

## WatchdogSupervisor

| Method | Returns | Description |
|--------|---------|-------------|
| `registerAgent(agentId, agent, metadata)` | `void` | |
| `unregisterAgent(agentId)` | `void` | |
| `start()` | `void` | Begin checking agents |
| `stop()` | `void` | |
| `restartAgent(agentId)` | `Promise<boolean>` | Force restart |
| `getStatus()` | `object` | healthy/warning/dead counts |

## HeartbeatSystem

| Method | Returns | Description |
|--------|---------|-------------|
| `registerPublisher(serviceId, provider, metadata)` | `void` | |
| `unregisterPublisher(serviceId)` | `void` | |
| `publish(serviceId, heartbeat)` | `void` | |
| `publishAll()` | `Promise<void>` | Publish from all registered providers |
| `start()` / `stop()` | `void` | |
| `getStatus()` | `object` | |

## DistributedCompute

| Method | Returns | Description |
|--------|---------|-------------|
| `registerNode(node)` | `string` | Node ID |
| `deregisterNode(nodeId)` | `boolean` | |
| `heartbeat(nodeId, updates)` | `boolean` | |
| `schedule(task, filter)` | `string` | Chosen node ID |
| `getStatus()` | `object` | |

## ObservabilityDashboard

| Method | Returns | Description |
|--------|---------|-------------|
| `recordSnapshot(sources)` | `object` | Snapshot |
| `getDashboard(sources)` | `object` | Dashboard + charts |
| `getCharts()` | `object` | Historical arrays |
| `exportMetrics(format)` | `string` | `json` or `prometheus` |
| `getStatus()` | `object` | |

## SecurityAuditor

| Method | Returns | Description |
|--------|---------|-------------|
| `runAudit()` | `Promise<object>` | Findings, env, DB permissions |
| `validateInput(input)` | `object` | `{ valid, issues }` |
| `encrypt(plaintext, key)` | `object` | `{ iv, authTag, data }` |
| `decrypt(ciphertext, key)` | `string` | |
| `rotateCredential(hint)` | `Promise<object>` | |

## MemoryIntegrity

| Method | Returns | Description |
|--------|---------|-------------|
| `runScan(memoryStores)` | `Promise<object>` | `{ passed, issues, repairs }` |
| `verify(memoryStores)` | `object` | Same, but synchronous |
| `getStatus()` | `object` | |

## CheckpointStore

| Method | Returns | Description |
|--------|---------|-------------|
| `initialize()` | `Promise<void>` | |
| `saveCheckpoint(state)` | `Promise<object>` | |
| `loadCheckpoint()` | `Promise<object\|null>` | |
