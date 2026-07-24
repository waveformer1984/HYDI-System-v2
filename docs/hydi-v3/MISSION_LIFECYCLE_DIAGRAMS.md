# HYDI V3 Mission Lifecycle Diagrams

This document describes the states and lifecycle of a mission and its tasks.

## Mission State Diagram

```mermaid
stateDiagram-v2
    [*] --> active : createMission()
    active --> replanning : replanMission()
    replanning --> active : plan complete
    active --> paused : pauseMission()
    paused --> active : resumeMission()
    active --> cancelled : cancelMission()
    paused --> cancelled : cancelMission()
    active --> completed : all tasks completed
    active --> failed : all tasks permanently_failed
    completed --> archived : archiveMission()
    failed --> archived : archiveMission()
    cancelled --> archived : archiveMission()
    archived --> [*]
```

## Task State Diagram

```mermaid
stateDiagram-v2
    [*] --> pending : addTask()
    pending --> running : startTask()
    running --> completed : completeTask()
    running --> failed : failTask()
    failed --> pending : replanMission() if retryCount < 3
    failed --> permanently_failed : replanMission() if retryCount >= 3
    pending --> ready : planMission() if dependencies complete
    ready --> running : startTask()
    completed --> [*]
    permanently_failed --> [*]
```

## Mission Lifecycle Flow

```mermaid
flowchart TD
    A[Operator creates mission] --> B[Mission status: active]
    B --> C[Add objectives and tasks]
    C --> D[Plan mission]
    D --> E{Topological sort}
    E -->|circular deps| F[Fallback to insertion order]
    E -->|success| G[Tasks marked ready]
    G --> H[Core loop requests pending tasks]
    H --> I[MissionPlanner.getNextTasks]
    I --> J[Return ready tasks by priority/deadline]
    J --> K[Core loop executes task]
    K --> L{Decision validated?}
    L -->|no| M[Reject task]
    L -->|yes| N[Execute action]
    N --> O[completeTask / failTask]
    O --> P{All tasks completed?}
    P -->|yes| Q[Mission completed]
    P -->|no| R{Failed with retries?}
    R -->|yes| S[Replan mission]
    S --> G
    R -->|no| T[Mission failed]
    Q --> U[ReflectionEngine.reflectOnMission]
```

## Task Dispatch Sequence

1. `MissionPlanner.planMission(missionId)` topologically sorts tasks.
2. `isTaskReady(mission, task)` returns `true` when:
   - `task.status === 'pending'`, and
   - all `task.dependencies` are completed.
3. `getNextTasks(capacity)` collects ready tasks across all active missions.
4. Tasks are sorted by:
   1. Priority (`critical` < `high` < `medium` < `low`)
   2. Deadline (earliest first)
   3. Created time (oldest first)
5. Top `capacity` tasks are returned to `coreLoop.getPendingTasks()`.

## Replanning Behavior

When `failTask()` is called and `autoReplan` is enabled:

- Increment `mission.failureCount`.
- If `task.retryCount < 3`:
  - Reset task to `pending` with `ready: true`.
- Else:
  - Mark task `permanently_failed`.
- Call `planMission()` again.
- `updateMissionProgress()` checks if the mission is completed or failed.
