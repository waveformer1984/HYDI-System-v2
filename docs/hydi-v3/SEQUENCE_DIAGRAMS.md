# HYDI V3 Sequence Diagrams

This document contains mermaid sequence diagrams for mission lifecycle, recovery, decision validation, and distributed scheduling.

## Mission Lifecycle

```mermaid
sequenceDiagram
    participant Operator
    participant AM as HYDIAutonomyManager
    participant MP as MissionPlanner
    participant CL as HeidiCoreLoop
    participant RE as ReflectionEngine

    Operator->>AM: createMission(name, objective)
    AM->>MP: createMission
    MP-->>AM: missionId
    AM-->>Operator: missionId

    Operator->>AM: missionPlanner.addObjective(missionId, obj)
    AM->>MP: addObjective
    Operator->>AM: missionPlanner.addTask(missionId, task)
    AM->>MP: addTask
    Operator->>AM: executeMission(missionId)
    AM->>MP: planMission(missionId)
    MP->>MP: topologicalSort
    MP-->>AM: true

    CL->>AM: getPendingTasks()
    AM->>MP: getNextTasks(capacity)
    MP-->>AM: ready tasks
    AM-->>CL: ready tasks

    CL->>AM: takeAction(task, decision)
    AM->>AM: decisionIntelligence.validateDecision
    AM-->>CL: result

    CL->>AM: loop_completed { task, decision, measurement }
    AM->>AM: decisionIntelligence.recordDecision
    AM->>MP: completeTask(taskId, missionId, result)
    MP->>MP: updateMissionProgress

    alt Mission completed
        MP-->>AM: mission_completed
        AM->>RE: reflectOnMission(mission)
        RE-->>AM: reflection
    end
```

## Recovery Flow

```mermaid
sequenceDiagram
    participant HS as HeartbeatSystem
    participant WS as WatchdogSupervisor
    participant AM as HYDIAutonomyManager
    participant SH as SelfHealingEngine
    participant Ops as Operator

    HS->>AM: heartbeat_missing [serviceId]
    AM->>SH: heal({ type: api_failure, target })
    SH->>SH: diagnose(symptom)
    SH->>SH: executePlan(retry_with_backoff)
    alt Success
        SH-->>AM: healing_completed
    else Failure / maxAttempts exceeded
        SH-->>AM: escalated
        AM-->>Ops: alert
    end

    WS->>AM: agent_dead { agentId, issues }
    AM->>SH: heal({ type: repeated_crash, target })
    SH->>SH: diagnose(repeated_crash)
    SH->>SH: executePlan(restart_and_reset)
    alt Success
        SH-->>AM: healing_completed
    else Failure
        SH-->>AM: escalated
    end
```

## Decision Validation

```mermaid
sequenceDiagram
    participant CL as HeidiCoreLoop
    participant AM as HYDIAutonomyManager
    participant DI as DecisionIntelligence
    participant CL2 as HeidiCoreLoop

    CL->>AM: takeAction(task, decision, loopId)
    AM->>DI: validateDecision(decision, { task, resources })
    DI->>DI: check resources, credentials, permissions
    DI->>DI: check riskScore, dangerous action, confidence
    DI->>DI: estimateSuccessProbability
    alt Valid
        DI-->>AM: { valid: true }
        AM->>CL2: originalTakeAction(task, decision, loopId)
        CL2-->>AM: result
    else Rejected
        DI-->>AM: { valid: false, reason }
        AM-->>CL: { status: rejected, reason, success: false }
    end
```

## Distributed Scheduling

```mermaid
sequenceDiagram
    participant AM as HYDIAutonomyManager
    participant DC as DistributedCompute
    participant NodeA as Node A
    participant NodeB as Node B

    AM->>DC: registerNode(local)
    AM->>DC: start()
    DC->>DC: checkNodes() interval

    AM->>DC: schedule(task, filter)
    DC->>DC: filter active nodes by capability
    DC->>DC: scoreNode(cpu, ram, latency, workload)
    DC-->>AM: nodeA

    NodeA-xDC: heartbeat timeout
    DC->>DC: mark failed, redistributeWork(nodeA)
    DC->>DC: schedule(task)
    DC-->>AM: nodeB
    AM->>NodeB: work assigned
```

## Graceful Shutdown

```mermaid
sequenceDiagram
    participant OS
    participant GS as GracefulShutdown
    participant AM as HYDIAutonomyManager
    participant CS as CheckpointStore

    OS->>GS: SIGTERM
    GS->>GS: onSignal(SIGTERM)
    GS->>AM: shutdown handler
    AM->>AM: stop()
    AM->>CS: saveCheckpoint(state)
    AM->>AM: persistAll()
    GS->>GS: shutdown_completed
    GS->>OS: process.exit(0)
```

## Memory Integrity Scan

```mermaid
sequenceDiagram
    participant AM as HYDIAutonomyManager
    participant MI as MemoryIntegrity
    participant Stores as Memory Stores

    AM->>MI: runScan({ reflectiveMemory, missions, agents, tasks, conversations })
    MI->>Stores: verifyReflectionMemory
    MI->>Stores: verifyMissionMemory
    MI->>Stores: verifyAgentMemory
    MI->>Stores: verifyTaskMemory
    MI->>Stores: verifyConversationMemory
    Stores-->>MI: issues, repairs
    MI-->>AM: { passed, issueCount, repairCount, issues, repairs }
```
