# HYDI V3 Data Flow Diagrams

This document describes how data flows between V2 core, V3 modules, persistence, and observability.

## High-Level Data Flow

```mermaid
flowchart LR
    subgraph V2[HYDI V2 Core]
        A[HeidiCoreLoop]
        B[HeidiOrchestrator]
        C[HeidiMemorySystem]
        D[HeidiActionLayer]
    end

    subgraph V3[HYDI V3 Layer]
        E[HYDIAutonomyManager]
        F[MissionPlanner]
        G[DecisionIntelligence]
        H[ReflectionEngine]
        I[SelfHealingEngine]
        J[ObservabilityDashboard]
        K[WatchdogSupervisor]
        L[HeartbeatSystem]
        M[CheckpointStore]
    end

    subgraph Persistence[data/]
        N[missions.json]
        O[decision_history.json]
        P[reflections.json]
        Q[checkpoints/latest.json]
    end

    A -->|getPendingTasks| E
    E -->|getNextTasks| F
    F --> N
    A -->|takeAction| E
    E -->|validateDecision| G
    G --> O
    A -->|loop_completed| E
    E -->|recordDecision| G
    F -->|mission_completed| H
    H --> P
    K -->|agent_dead| I
    L -->|heartbeat_missing| I
    E -->|recordSnapshot| J
    E --> M
```

## Mission Data Flow

```mermaid
flowchart TD
    Operator -->|createMission| AM[HYDIAutonomyManager]
    AM -->|createMission| MP[MissionPlanner]
    MP -->|persist| Missions[data/missions/missions.json]
    Operator -->|addObjective / addTask| AM
    AM -->|mutate| MP
    MP -->|persist| Missions
    CL[HeidiCoreLoop] -->|getPendingTasks| AM
    AM -->|getNextTasks| MP
    MP -->|ready tasks| AM
    AM -->|tasks| CL
    CL -->|completeTask| AM
    AM -->|completeTask| MP
    MP -->|update progress| Missions
    MP -->|mission_completed| RE[ReflectionEngine]
    RE -->|persist| Reflections[data/reflections/reflections.json]
```

## Decision Data Flow

```mermaid
flowchart TD
    CL[HeidiCoreLoop] -->|takeAction(task, decision)| AM[HYDIAutonomyManager]
    AM -->|validateDecision| DI[DecisionIntelligence]
    DI -->|load history| Decisions[data/decisions/decision_history.json]
    DI -->|valid / rejected| AM
    AM -->|originalTakeAction| CL
    CL -->|loop_completed| AM
    AM -->|recordDecision| DI
    DI -->|append| Decisions
```

## Recovery Data Flow

```mermaid
flowchart TD
    WS[WatchdogSupervisor] -->|agent_dead| AM[HYDIAutonomyManager]
    HS[HeartbeatSystem] -->|heartbeat_missing| AM
    MP[MissionPlanner] -->|task_failed| AM
    AM -->|heal| SH[SelfHealingEngine]
    SH -->|diagnose| Plan[Recovery Plan]
    SH -->|executePlan| Actions[Action Handlers]
    Actions -->|success| SH
    SH -->|healing_completed| AM
    SH -->|escalated| Ops[Operator / Alerting]
```

## Observability Data Flow

```mermaid
flowchart TD
    AM[HYDIAutonomyManager] -->|recordObservabilitySnapshot| OD[ObservabilityDashboard]
    OD -->|read status| WS[WatchdogSupervisor]
    OD -->|read status| HS[HeartbeatSystem]
    OD -->|read status| MP[MissionPlanner]
    OD -->|read status| DI[DecisionIntelligence]
    OD -->|read metrics| CL[HeidiCoreLoop]
    OD -->|append| History[history arrays]
    User -->|getDashboard| OD
    Prometheus -->|scrape| OD
```

## Checkpoint Data Flow

```mermaid
flowchart TD
    Start[HYDI start] --> AM[HYDIAutonomyManager]
    AM -->|loadCheckpoint| CS[CheckpointStore]
    CS -->|read| CP[data/checkpoints/latest.json]
    AM -->|restore state| MP[MissionPlanner]
    AM -->|restore state| DI[DecisionIntelligence]
    AM -->|restore state| RE[ReflectionEngine]
    Shutdown[HYDI stop] --> AM
    AM -->|saveCheckpoint| CS
    CS -->|write| CP
```
