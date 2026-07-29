# Phase 42 — HYDI Collaborative Execution Architecture

## Overview

Phase 41 built a secure federation: nodes can discover each other, authenticate,
encrypt messages, and share memory. Phase 42 makes that federation useful by
adding an intelligent workload coordination layer that decides **who should run
what** and **what to do when the answer changes**.

The execution fabric is composed of three layers:

- **Resource & capability awareness** — `ResourceMonitor`, `CapabilityBroker`
- **Planning & placement** — `NodeScorer`, `ExecutionPlanner`, `WorkloadBalancer`, `TaskMigrationManager`
- **Coordination & observation** — `DistributedQueue`, `ConsensusManager`, `FederationMetrics`, `SwarmCoordinator`, `SwarmDashboard`

A new `ServiceContract` layer is also introduced to keep these subsystems
interoperable without becoming welded to one another.

## Components

| Module | Responsibility |
|--------|---------------|
| `ServiceContract.js` | Versioned, validated interfaces between subsystems |
| `NodeScorer.js` | Transparent, explainable node scoring for tasks |
| `ResourceMonitor.js` | CPU, GPU, RAM, latency, workload, model, and health sampling |
| `CapabilityBroker.js` | Finds trusted providers for required capabilities |
| `DistributedQueue.js` | Priority queue with reservation, ack, expiry, cancellation, ownership |
| `WorkloadBalancer.js` | Continuous re-evaluation and task migration |
| `TaskMigrationManager.js` | Safe task movement between trusted nodes |
| `ConsensusManager.js` | Lightweight quorum for ownership and lifecycle state |
| `FederationMetrics.js` | Swarm-wide throughput, health, and trend metrics |
| `ExecutionPlanner.js` | Builds and explains a plan for each task |
| `SwarmCoordinator.js` | Top-level orchestration entry point |
| `SwarmDashboard.js` | Human-readable swarm status |

## Scheduling Model

1. A task is submitted to `SwarmCoordinator.submit(task, options)`.
2. `ExecutionPlanner` collects healthy nodes from `ResourceMonitor`, filters by
   `requiredCapabilities`, and ranks candidates with `NodeScorer`.
3. The highest-scoring, policy-allowed node is chosen and the task is reserved
   in `DistributedQueue`.
4. `DistributedTaskManager` is asked to advertise and assign the task to the
   chosen node.
5. `WorkloadBalancer` periodically re-runs scoring for reserved work and
   migrates tasks to better nodes when the improvement exceeds the threshold.

## Scoring Algorithm

`NodeScorer` uses a configurable weighted model. Default weights:

```text
Capability match     30%
Trust level          20%
Resource availability 20%
Latency              15%
Health               10%
Strategic priority    5%
```

Each dimension is normalized to `[0, 1]` and multiplied by its normalized
weight. The total is the sum of these products. `NodeScorer.explain(result)`
renders a human-readable breakdown so HYDI can answer "why this node?".

Ties are broken deterministically by `nodeId` lexicographic order, ensuring the
same input always produces the same plan.

## Task Lifecycle

```text
queued → reserved → acknowledged → executing → completed
          ↓              ↓              ↓
        expired        cancelled        failed → retried → dead
```

- `queued`: waiting for a node.
- `reserved`: assigned to a specific node.
- `acknowledged`: the node has accepted the task.
- `completed`: result recorded.
- `failed`: returned to the queue for retry up to a limit, then dead-lettered.
- `cancelled`: removed by an explicit operator or policy call.
- `expired`: reservation timed out, returned to the queue.

## Recovery Model

- **Node disappearance** — `WorkloadBalancer.rebalanceAfterFailure(nodeId)`
  returns all owned tasks to the queue. `WorkloadBalancer` will then re-place
  them on healthy nodes.
- **Task failure** — `DistributedQueue` retries up to a configured limit and
  then marks the task dead.
- **Reservation expiry** — the reaper returns stale reserved items to `queued`.
- **Network interruption** — `ConsensusManager` uses short TTL proposals; stale
  proposals are naturally rejected if a quorum is not reached in time.
- **Duplicate prevention** — each queue item has a stable id and reservation is
  tracked by `owner` in the queue state.

## Consensus Layer

`ConsensusManager` is intentionally lightweight. It supports:

- `propose(topic, value)` — broadcasts a proposal to the mesh.
- `vote(proposalId, nodeId, accepted)` — records a vote.
- `decide(topic, timeoutMs)` — waits for quorum or timeout.

Quorum defaults to 51% of trusted, known peers. It is used for task ownership
and lifecycle state, not for general state replication.

## Governance Integration

The execution fabric is governed by the same controls as earlier phases:

- `NodePolicy` validates trust and permissions before any migration or plan.
- `LifecycleRegistry` can be notified of task and node lifecycle events.
- `FederationMetrics` emits metrics that can feed `ObservabilityDashboard`.
- `ServiceContract` keeps subsystem boundaries explicit and versioned.

## Operator Controls

- `SwarmCoordinator.start()` / `stop()` — boot or shut down the fabric.
- `SwarmCoordinator.submit(task)` — place a task.
- `SwarmCoordinator.queryCapability(capabilityId)` — find providers.
- `SwarmCoordinator.propose(topic, value)` — propose a collective decision.
- `SwarmDashboard.render()` — get a human-readable status snapshot.
- `FederationMetrics.export('json' | 'csv')` — export metrics.

## Performance Considerations

- Scoring is deterministic and local; no global consensus is required to place a
  routine task.
- The queue reaper and load balancer run on bounded intervals and can be tuned.
- Metrics history is capped by `historyLimit` to avoid unbounded memory growth.
- `CapabilityBroker` keeps provider lists in memory and refreshes through
  advertisements and explicit queries.

## Known Limitations

- The consensus manager is a basic majority vote, not a full Byzantine fault
  tolerant protocol.
- The default `ResourceMonitor` samples local OS metrics; GPU detection is
  currently a placeholder and should be swapped for vendor-specific probes.
- Real network transports for `NodeMesh` remain an adapter exercise for future
  phases.

## Validation

```bash
npm run swarm-test
npm run scheduling-test
npm run workload-test
npm run migration-test
npm run failure-recovery-test
npm run federation-test
npm run marketplace-test
npm run lifecycle-test
npm run typecheck
npm test
```

All Phase 42 components and tests were added to `src/hydi-v3/` and
`tests/unit/hydi-v3/`.
