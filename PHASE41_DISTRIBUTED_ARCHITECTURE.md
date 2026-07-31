# Phase 41 — Distributed Multi-Node HYDI Architecture

## Purpose

Phase 41 extends HYDI from a single-node operating environment into a secure,
local-first, multi-node federation. The goal is to let multiple HYDI instances
(peer nodes) discover each other, authenticate, exchange encrypted messages,
schedule work across heterogeneous hardware, share memory safely, and continue
operating when partitions occur — without relaxing the lifecycle, governance,
compatibility, or permission models built in earlier phases.

Phase 41 is **analysis and design only**. No network implementation is to be
merged until the design is accepted.

## Design Principles

1. **Local-first federation** — nodes must operate correctly when disconnected.
   Network is an optimization, not a requirement.
2. **Zero-trust networking** — no node is trusted because it is on the same LAN.
   Every message is authenticated and authorized.
3. **Fail-safe by default** — partitions, node failures, and Byzantine messages fail
   closed and are observable.
4. **Reuse existing subsystems** — extend `DistributedCompute`, `LifecycleRegistry`,
   `MarketplaceManager`, `CapabilitySandbox`, `ObservabilityDashboard`, and
   `SnapshotManager` instead of replacing them.
5. **Determinism and reproducibility** — shared state converges to the same value
   given the same ordered inputs; non-determinism is isolated and logged.

## Current Foundation

`src/hydi-v3/DistributedCompute.js` already provides in-process primitives:

- `registerNode(node)` / `deregisterNode(nodeId)`
- `heartbeat(nodeId, updates)`
- `schedule(task, filter)` with capability-weighted scoring
- `redistributeWork(failedNodeId)`
- `electLeader()` / `getLeader()`
- `getStatus()`, `getLoadReport()`, `migrateMission(...)`

These primitives are trusted, single-process, and have no cryptographic
identity or transport. Phase 41 wraps them with `NodeMesh`, `NodeIdentity`,
`NodeDiscovery`, `NodeTransport`, `SharedMemoryStore`, and `ConflictResolver`.

## Proposed Components

| Component | Proposed File | Responsibility |
|-----------|---------------|----------------|
| `NodeIdentity` | `src/hydi-v3/NodeIdentity.js` | Per-node Ed25519 keypair, `nodeId` as stable public-key hash, certificate/store operations, revocation list. |
| `NodeDiscovery` | `src/hydi-v3/NodeDiscovery.js` | Local mDNS, bootstrap seed lists, gossip announcements. No central registry required. |
| `NodeTransport` | `src/hydi-v3/NodeTransport.js` | Encrypted P2P channel abstraction (Noise XX or TLS 1.3 with pinned certs). |
| `NodeMesh` | `src/hydi-v3/NodeMesh.js` | Composition of `DistributedCompute` + network layer: peer registry, heartbeat gossip, task routing. |
| `SharedMemoryStore` | `src/hydi-v3/SharedMemoryStore.js` | CRDT-backed memory replication across nodes with vector-clock causality. |
| `ConflictResolver` | `src/hydi-v3/ConflictResolver.js` | Deterministic conflict resolution per memory type (LWW, semantic merge, last-writer-wins with vector clocks). |
| `FederationGateway` | `src/hydi-v3/FederationGateway.js` | Offline queue, partition detection, deferred sync, and bridge policy. |
| `AITaskScheduler` | `src/hydi-v3/AITaskScheduler.js` | Model-capability aware scheduling; extends `DistributedCompute.schedule`. |
| `NodeSecurityAuditor` | `src/hydi-v3/NodeSecurityAuditor.js` | Verifies node attestation, signature freshness, permission compatibility. |

## Architecture Overview

```
                          +------------------+
                          |   Operator CLI   |
                          |  / Dashboard     |
                          +---------+--------+
                                    |
                          +---------v--------+
                          |  AutonomyManager |
                          +---------+--------+
                                    |
        +---------------------------+---------------------------+
        |                           |                           |
+-------v-------+      +------------v-----------+   +----------v----------+
|  NodeMesh     |      |  SharedMemoryStore     |   |  AITaskScheduler    |
|               |      |  (CRDT + snapshots)    |   |  (model-aware)      |
+---+-------+---+      +-----------+------------+   +----------+----------+
    |       |                      |                              |
    |   +---v------------+    +----v----+                 +-------v-------+
    |   | NodeTransport  |    |Conflict |                 | Distributed   |
    |   | (encrypted)    |    |Resolver |                 | Compute       |
    |   +---+------+---+    +---------+                 +-------+-------+
    |       |      |                                          |
    |   +---v------v---+                                +-----v-----+
    |   | NodeDiscovery|                                | Lifecycle |
    |   | (mDNS/gossip)|                                | Registry  |
    |   +--------------+                                +-----------+
    |
    |      P2P encrypted links
    +-------------------------------->  Peer HYDI Nodes
```

## Component Boundaries

### NodeIdentity

- Owns the node's long-term Ed25519 keypair.
- Generates and validates `nodeId = base58(sha256(publicKey))`.
- Signs and verifies payloads (heartbeats, tasks, state deltas).
- Stores a revocation list of banned node IDs and publisher keys from the
  `PublisherRegistry`.
- **No network access** — pure cryptography.

### NodeDiscovery

- Broadcasts and listens on local multicast (mDNS) for `service _hydi._tcp`.
- Accepts a static `bootstrapNodes` array for non-mDNS deployments.
- Gossips known good peers to new nodes, but never trusts a gossiped node
  until `NodeIdentity` validates a direct signed handshake.
- **Boundary**: discovery only returns candidate `host:port` + `nodeId`;
  authentication is `NodeTransport`'s job.

### NodeTransport

- Establishes an encrypted, authenticated, forward-secret channel to each peer.
- Default protocol: **Noise XX** (libsodium compatible) with `nodeId` derived
  from the static public key. Fallback: TLS 1.3 with certificate pinning.
- Every inbound message is: decrypt -> verify signature -> authorize via
  `CapabilitySandbox` network permission -> route to `NodeMesh`.
- **Boundary**: transport is a dumb reliable datagram/stream; it does not
  interpret business messages.

### NodeMesh

- Wraps `DistributedCompute` and maps network peers to `DistributedCompute`
  node records.
- Translates remote heartbeats into `distributedCompute.heartbeat(nodeId, metrics)`.
- Relays `schedule(task)` to the mesh if the task is declared `distributable`;
  otherwise executes locally through `ExecutionGateway`.
- Emits `node_joined`, `node_left`, `node_failed`, `work_assigned`, and
  `mesh_partition` events for `ObservabilityDashboard`.
- **Boundary**: `NodeMesh` is the only component that knows both the transport
  layer and the compute layer.

### AITaskScheduler

- Extends `DistributedCompute` scoring with model-specific weights:
  `gpu`, `vram`, `cachedModel`, `quantization`, `ollama`/`llama.cpp`/`vLLM` runtime.
- Rejects scheduling a model inference task to a node that does not advertise
  the required model or capability.
- Supports task **affinity** (a session must stay on one node) and **anti-affinity**
  (redundant inference for consensus).
- **Boundary**: pure scheduling; execution still goes through `ExecutionGateway`
  and `CapabilitySandbox`.

### SharedMemoryStore

- Replicates selected memory namespaces (sessions, missions, reflections, facts)
  as CRDTs with **version vectors**.
- Each write is `(value, vectorClock, nodeId, timestamp, signature)`.
- Persists locally first, queues async replication to reachable peers.
- **ConflictResolver** selects the winning value per namespace policy:
  - `sessions`: last-writer-wins with vector-clock tie break.
  - `missions`: semantic merge (union of tasks, min of statuses).
  - `facts`: append-only set; conflicts become new `fact` entries for operator review.
- **Boundary**: the store does not execute actions; it only provides
  strongly-consistent-where-possible reads and eventual-consistent writes.

### ConflictResolver

- Implements deterministic merge functions per `memoryType`.
- Detects concurrent writes (`vectorClock` incomparable) and flags them in the
  observability log as `conflict_detected`.
- Never silently discards data; unresolved conflicts are preserved as branched
  records with a `conflictId` for operator reconciliation.

### FederationGateway

- Maintains an **outbox** of messages for each peer while partitioned.
- Detects partition onset/restore via heartbeat timeout and mDNS events.
- On restore, performs an **anti-entropy sync**: exchange vector clocks and
  missing CRDT deltas.
- Enforces `federationPolicy` from governance: which namespaces may leave the
  node, which nodes may be federated, and offline-time limits.

### NodeSecurityAuditor

- Mirrors `SecurityAuditor` for mesh concerns:
  - signature freshness (no replay)
  - node trust level (unknown / peer / verified / revoked)
  - capability compatibility (a node cannot receive a task it is not allowed to see)
- Logs `security_violation` events and optionally quarantines a peer.

## Public Interfaces

```js
// NodeIdentity
const identity = new NodeIdentity({ dataPath });
await identity.initialize();
const nodeId = identity.id;
const signed = identity.sign(payload);
const verified = identity.verify(signed, remoteNodeId);

// NodeDiscovery
const discovery = new NodeDiscovery({ identity, multicast: true });
discovery.on('peer', ({ host, port, nodeId }) => { ... });
await discovery.start();

// NodeTransport
const transport = new NodeTransport({ identity });
const peer = await transport.connect({ host, port, nodeId });
peer.send(message); // returns delivery receipt
peer.on('message', (msg) => { ... });

// NodeMesh
const mesh = new NodeMesh({
  identity,
  discovery,
  transport,
  distributedCompute: new DistributedCompute(config),
  lifecycleRegistry,
  observability,
});
await mesh.start();
mesh.schedule(task); // local or remote
delete mesh.stop();

// SharedMemoryStore
const shared = new SharedMemoryStore({ identity, mesh, namespace: 'sessions' });
await shared.write(key, value);
const { value, vectorClock } = await shared.read(key, { consistent: true });

// FederationGateway
const gateway = new FederationGateway({ mesh, sharedMemoryStore, policy });
await gateway.sync(remoteNodeId); // explicit anti-entropy
```

## Data Flows

### 1. Node Join

```
Local HYDI starts
    |
    v
NodeIdentity loads/creates keypair
    |
    v
NodeDiscovery advertises nodeId + port on mDNS
    |
    v
Peer sees advertisement
    |
    v
NodeTransport performs Noise XX handshake
    |
    v
NodeIdentity verifies static key matches nodeId
    |
    v
NodeMesh registers peer in DistributedCompute
    |
    v
LifecycleRegistry records new 'NodeMesh' capability
```

### 2. Task Distribution

```
Operator or agent requests a model inference task
    |
    v
ExecutionGateway classifies action
    |
    v
AITaskScheduler scores candidate nodes
    |
    v
NodeMesh routes task to chosen node (or local)
    |
    v
Remote CapabilitySandbox enforces permissions
    |
    v
Result is signed and returned
    |
    v
ObservabilityDashboard records latency/outcome
```

### 3. Memory Replication

```
Local write to SharedMemoryStore
    |
    v
Store persists locally, updates vector clock, signs delta
    |
    v
FederationGateway queues delta for each reachable peer
    |
    v
NodeTransport sends encrypted delta
    |
    v
Remote SharedMemoryStore applies delta, ConflictResolver merges
    |
    v
Both nodes emit `memory_sync` event
```

### 4. Partition and Recovery

```
Heartbeat missed for node X for > nodeTimeoutMs
    |
    v
DistributedCompute marks X failed, redistributes work
    |
    v
FederationGateway persists an outbox for X
    |
    v
X reappears on mDNS
    |
    v
FederationGateway performs anti-entropy sync
    |
    v
ConflictResolver merges branched state
    |
    v
LifecycleRegistry health restored
```

## Security Considerations

1. **Identity**. `nodeId` is derived from the public key. Private keys never
   leave the node `dataPath` and are encrypted at rest when the OS supports it.
2. **Authentication**. Every handshake and message is signed. Replay is prevented
   by monotonic sequence numbers and short-lived nonces.
3. **Authorization**. The `CapabilitySandbox` from Phase 40 is reused: remote
   requests are treated as `network` domain actions and must be explicitly
   permitted by the receiving node's installed capabilities.
4. **Encryption**. All wire traffic uses forward-secret negotiated keys (Noise XX
   or TLS 1.3). Metadata (nodeId, advertised services) is encrypted after the
   handshake; mDNS payloads are signed but not encrypted.
5. **Trust levels**. Nodes can be `untrusted` / `community` / `verified` /
   `official`, mirroring publisher trust levels. Revocation is checked against
   `PublisherRegistry` and a local block list.
6. **Zero-trust**. A node that appears on the same LAN is not trusted until it
   completes a cryptographic handshake and passes `NodeSecurityAuditor`.
7. **Least privilege**. Each federated namespace declares required permissions
   (`memory:read`, `memory:write`, `inference:gpu`, etc.). Requests that exceed
   those permissions are rejected.
8. **Privacy**. Sensitive memory namespaces (e.g., sessions) can be marked
   `local-only` and never replicated.

## Migration Strategy

1. **Additive only**. Phase 41 introduces new `src/hydi-v3/Node*.js` modules.
   `DistributedCompute`, `LifecycleRegistry`, and `ExecutionGateway` remain
   unchanged until the network layer is accepted.
2. **Feature flag**. `AutonomyManager` gains `enableNodeMesh: false` by default.
   Existing single-node deployments are unaffected.
3. **Local-only rehearsal**. Operators can run `hydi mesh start --loopback` to
   exercise all new components on one machine with two ports.
4. **No schema break**. `SharedMemoryStore` adds optional CRDT metadata; legacy
   memory stores ignore unknown fields.
5. **Marketplace extension**. Nodes can publish/retrieve `node-capability`
   packages through the existing `MarketplaceManager` (Phase 40). The network
   runtime is just another installable capability type.
6. **Rollback**. If `NodeMesh` is disabled, the system reverts to the current
   single-node `DistributedCompute` behavior. `SnapshotManager` captures mesh
   state for offline rollback.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Replay or spoofed heartbeats | High | Ed25519 signatures, nonces, sequence numbers in `NodeTransport`. |
| Concurrent scheduling races | Medium | `DistributedCompute` already flags workload mutation race in `ArchitectureAudit`; Phase 41 serializes `schedule` per node in `NodeMesh`. |
| Partition-induced split-brain | Medium | Vector clocks and deterministic `ConflictResolver`; no leadership required for read-only local work. |
| Revocation not propagating | Medium | Revocation list gossiped with signatures; expiry windows. |
| CRDT memory growth | Medium | Periodic compaction, snapshot pruning, and `local-only` namespaces. |
| Complexity leakage into core | High | Strict component boundaries; `NodeMesh` is the only bridge between network and compute. |
| Supply-chain of model shards | Medium | `MarketplaceManager` verifies signatures and trust levels before a model is loaded from a peer. |

## Acceptance Criteria

1. `NodeIdentity` can generate a keypair, derive a stable `nodeId`, sign and
   verify payloads.
2. `NodeDiscovery` discovers two loopback HYDI instances without a central server.
3. `NodeTransport` rejects an inbound connection whose static key does not match
   the advertised `nodeId`.
4. `NodeMesh` registers a remote node, sends a heartbeat, and triggers `node_failed`
   when the remote process stops.
5. `AITaskScheduler` refuses to schedule a GPU task to a CPU-only node.
6. `SharedMemoryStore` replicates a write to a peer and converges after a
   simulated partition.
7. `ConflictResolver` produces the same merged value on both sides of a partition
   given the same inputs.
8. `ExecutionGateway` rejects a remote action that the local `CapabilitySandbox`
   has not permitted.
9. `ObservabilityDashboard` reports mesh health, partition events, and security
   violations.
10. `LifecycleRegistry` records `NodeMesh` health and rollback snapshots include
    `SharedMemoryStore` vector clocks.

## Recommended Implementation Order

1. **NodeIdentity** — keypair + signing/verification.
2. **NodeTransport** — encrypted loopback channels + rejection tests.
3. **NodeDiscovery** — mDNS and bootstrap seed list (local-only tests).
4. **NodeMesh** — wire `NodeTransport` into `DistributedCompute` with heartbeat
   relay.
5. **AITaskScheduler** — extend `DistributedCompute.schedule` with model/runtime
   filters.
6. **SharedMemoryStore + ConflictResolver** — single-node CRDT write/read and
   merge tests.
7. **FederationGateway** — offline queue and anti-entropy sync.
8. **NodeSecurityAuditor** — revocation, replay, and permission checks.
9. **Observability + Lifecycle integration** — `mesh_joined`, `mesh_partition`,
   `security_violation` events and snapshots.
10. **End-to-end integration test** — two loopback nodes, scheduling, partition,
    sync, rollback.

## Integration with Existing Subsystems

| Existing System | Integration Point |
|-----------------|-------------------|
| `LifecycleRegistry` | `NodeMesh` registers itself as a component; `FederationGateway` reports `healthy`/`partitioned`/`degraded`. |
| `MarketplaceManager` | `NodeCapability` packages are discovered, verified, and installed like any Phase 40 capability. Publisher trust levels apply. |
| `CapabilitySandbox` | Remote `ExecutionGateway` requests are treated as `network` domain actions; permissions must be declared. |
| `ObservabilityDashboard` | `NodeMesh` emits mesh events; `NodeSecurityAuditor` emits security events. |
| `SnapshotManager` | Mesh and `SharedMemoryStore` vector clocks are included in snapshots for deterministic rollback and replay. |
| `Governance` | New `NodeMesh` components and `federationPolicy` require an RFC under `GOVERNANCE.md`. Migration and rollback tests required. |

## Open Questions for RFC

1. Should the transport default be Noise XX or TLS 1.3? TLS may be easier for
   enterprise firewalls; Noise is lighter and more local-first.
2. How are model weights and model-cache metadata shared without leaking
   proprietary data? (Possible: capability-signed manifest + optional encrypted
   payload.)
3. What is the maximum tolerated partition duration before a node is considered
   permanently `left` and its state archived?
4. Should leader election be required at all, or should the mesh remain
   leaderless with `ConflictResolver` and `FederationGateway` handling coordination?
