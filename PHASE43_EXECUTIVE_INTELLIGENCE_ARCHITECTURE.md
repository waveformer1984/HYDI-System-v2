# Phase 43 — HYDI Executive Intelligence and Strategic Mission Management

## Overview

Phase 43 adds an executive planning layer on top of the existing federation.
It does not replace the execution fabric from Phase 42, the marketplace from
Phase 40, the lifecycle system from Phase 39, or the governance controls from
earlier phases. Instead, it produces strategic plans and feeds them into the
established execution, federation, and governance subsystems.

## Components

| Module | Responsibility |
|--------|---------------|
| `GoalManager.js` | Create, link, and transition strategic goals |
| `DecisionJournal.js` | Permanent audit trail of strategic decisions |
| `StrategicMemory.js` | Long-term planning memory and lessons learned |
| `DependencyPlanner.js` | Dependency graph, cycle detection, ordering |
| `ResourceAllocator.js` | Track and allocate federation resources |
| `ForecastEngine.js` | Conservative, explainable execution forecasts |
| `RiskAnalyzer.js` | Multi-dimensional risk scoring with rationale |
| `MissionPlanner.js` | Decompose objectives into phases and milestones |
| `ExecutionRoadmap.js` | Time-ordered, resource-aware execution roadmap |
| `StrategicPlanner.js` | Prioritize goals, generate plans, adapt and replan |
| `ProgressTracker.js` | Record and report progress, blockers, and trends |
| `ExecutiveDashboard.js` | Human-readable executive status view |

## Planning Architecture

```
[Executive Dashboard]
       |
[Strategic Planner] -> [Decision Journal]
       |                      |
[Goal Manager]         [Strategic Memory]
       |
[Mission Planner] -> [Dependency Planner]
       |
[Execution Roadmap]
       |
[Resource Allocator] + [Forecast Engine] + [Risk Analyzer]
       |
[Federation Gateway / Swarm Coordinator]
```

## Decision Flow

1. **Goal creation** — `GoalManager` validates state and policy, records an
   audit event, and emits `goal_created`.
2. **Strategic planning** — `StrategicPlanner` gathers active/proposed goals,
   prioritizes them by `strategicValue * priority / effort`, resolves
   dependencies, and produces a deterministic plan. The plan is recorded in the
   `DecisionJournal`.
3. **Mission planning** — `MissionPlanner` breaks each objective into phases,
   verifies the phase dependency graph, and generates milestones.
4. **Roadmapping** — `ExecutionRoadmap` produces a time-ordered sequence. Each
   step is annotated with a `ForecastEngine` duration and a `RiskAnalyzer`
   score.
5. **Execution request** — The roadmap is passed to `FederationGateway` or
   `SwarmCoordinator` for execution. The strategic layer never bypasses
   `NodePolicy`, `LifecycleRegistry`, or `ServiceContract`.
6. **Progress tracking** — `ProgressTracker` records milestone completion,
   blockers, and replanning events.
7. **Dashboard** — `ExecutiveDashboard` aggregates goals, resources, progress,
   federation health, and decision history into a single view.

## Goal Lifecycle

```
proposed -> approved -> active -> completed
                  |        |
                  +----> blocked
                  |
                  +----> cancelled
                  |
                  +----> failed
```

All transitions are validated, audited, and can be gated by `NodePolicy`.

## Resource Model

`ResourceAllocator` tracks:

- CPU, GPU, RAM, storage
- AI model availability
- Federation node capacity
- Marketplace capability providers
- Human approval requirements

It recommends whether a task is feasible before any commitment is made. It does
not assume unlimited resources.

## Forecasting Methodology

`ForecastEngine` uses a conservative base-rate model:

- `duration = effort / (baseRate * parallelism) * uncertainty`
- Resource usage is derived linearly from duration.
- Bottlenecks are flagged when a required resource is missing.
- Completion probability is lowered by risk and bottleneck count.
- Every forecast carries an `assumptions` list explaining how it was derived.

No fabricated precision is produced.

## Risk Model

`RiskAnalyzer` scores across six dimensions:

| Dimension | Weight | Basis |
|-----------|--------|-------|
| Execution | 25% | Effort and complexity |
| Dependency | 20% | Missing and numerous dependencies |
| Resource | 20% | Resource demand vs. availability |
| Security | 15% | Approval requirements |
| Policy | 10% | Current policy validation |
| Federation | 10% | Healthy peer count |

A plan is `acceptable` when its overall score is below the configured
`riskThreshold`. Each assessment includes a `rationale` identifying the
highest-scoring dimension.

## Governance Integration

The strategic layer may *request* execution. It may never:

- bypass `NodePolicy`
- bypass `LifecycleRegistry`
- bypass `MarketplaceManager`
- bypass `ServiceContract` validation
- execute actions directly

Execution always flows through `SwarmCoordinator` / `FederationGateway` and
`ExecutionPlanner`, which already enforce trust, capability, and policy checks.

## Executive Dashboard

The dashboard surfaces:

- active goal count and top priorities
- goals by state
- progress summary (completed, blocked, active, pending, failed)
- available resources
- federation utilization
- blocked work count
- decision-journal size
- active strategic plan IDs

## Operator Procedures

- `GoalManager.createGoal(input)` to add an objective.
- `StrategicPlanner.plan()` to generate a prioritized plan.
- `MissionPlanner.defineMission(goalId)` and `addPhase()` to decompose work.
- `ExecutionRoadmap.createRoadmap(items)` to build a schedule.
- `ExecutiveDashboard.render()` for a human-readable status summary.
- `DecisionJournal.list()` to review the audit trail.

## Validation

```bash
npm run strategy-test
npm run planning-test
npm run forecast-test
npm run risk-test
npm run progress-test
npm run executive-test
npm run federation-test
npm run lifecycle-test
npm run typecheck
npm test
```

## Known Limitations

- `ForecastEngine` is intentionally simple; domain-specific models can be
  swapped in by replacing the base-rate estimate.
- `ResourceAllocator` does not yet pull real-time GPU metrics; it uses the
  provided or monitored resource capacities.
- `StrategicMemory` keeps an in-memory store with optional integration to a
  `memoryClient`. Persistent backend integration can be added in a later phase.
