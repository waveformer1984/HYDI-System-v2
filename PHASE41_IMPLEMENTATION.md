# Phase 41 Implementation — HYDI Distributed Federation

## Overview

Phase 41 extends HYDI v3 from a single-node operating system into a secure,
local-first, multi-node federation. The design follows the approved
`PHASE41_DISTRIBUTED_ARCHITECTURE.md` and reuses the existing lifecycle,
governance, observability, marketplace, and security subsystems.

### Components

| File | Responsibility |
|------|----------------|
| `NodeIdentity.js` | Ed25519 node identity, fingerprint, trust, version compatibility |
| `NodeTransport.js` | Encrypted, authenticated, replay-protected messaging abstraction |
| `NodeDiscovery.js` | Trusted peer discovery: static, manual, and offline capable |
| `NodeMesh.js` | Peer management, topology, message routing, health monitoring |
| `NodeHeartbeat.js` | Periodic heartbeats and peer liveness tracking |
| `NodeScheduler.js` | Deterministic, policy-aware task scheduling |
| `NodePolicy.js` | Trust, capability, and permission enforcement with audit |
| `FederationGateway.js` | Single entry point for remote execution, sync, and governance |
| `SharedMemoryStore.js` | CRDT-backed memory with vector-clock conflict resolution |
| `DistributedTaskManager.js` | Task advertisement, assignment, execution, retry, rollback |
| `DistributedLifecycle.js` | Cross-node lifecycle registration and health |
| `FederationDashboard.js` | Operator-facing federation status aggregation |

## Architecture

```
[FederationGateway]
       |
[NodeMesh] -- [NodeTransport] -- [NodeIdentity]
       |                |
[NodeDiscovery]   [SharedMemoryStore]
       |
[DistributedCompute] -- [NodeScheduler]
       |
[DistributedTaskManager] -- [DistributedLifecycle] -- [FederationDashboard]
```

All components are EventEmitter-based and follow the CommonJS style of the
existing `src/hydi-v3/` modules.

## Protocol Description

### Identity

- Each node generates an Ed25519 key pair on first `init()`.
- `nodeId` is a base64url-encoded SHA-256 hash of the SPKI public key.
- The fingerprint is the hex SHA-256 hash of the public key.
- Identity is persisted to `data/node-identity.json` and validated on reload.

### Transport

- `NodeTransport` is protocol-agnostic. The default `LoopbackTransport` is an
  in-memory AES-256-GCM encrypted channel used for local tests and simulation.
- Every message is signed by the sender's Ed25519 private key.
- Receivers verify signatures against the registered peer's public key.
- Nonces and timestamps provide replay protection within a 5-minute window.
- Out-of-order, expired, replayed, or unsigned messages are rejected and emitted
  as `rejected` / `untrusted` events.

### Discovery

- Static peers, manual peers, and optional local multicast are supported.
- Discovery returns candidate `host:port` and `nodeId` only; it never marks an
  unknown peer as trusted.
- Trust is established by the operator or an out-of-band mechanism and stored in
  `NodeIdentity`.

### Shared Memory

- Namespaces (`sessions`, `missions`, `facts`) store values with vector clocks.
- Causal ordering is respected; concurrent writes are detected and resolved
  according to the namespace policy:
  - `sessions`: last-writer-wins with deterministic tie break.
  - `missions`: semantic merge (union).
  - `facts`: append-only set.
- No conflicting data is silently overwritten; unresolved conflicts are kept for
  operator review.

### Tasks

- Tasks are advertised as `{type, payload, requestedBy}` over `task_advert`.
- Receiving nodes execute only pre-registered local handlers; no remote code is
  accepted or run.
- `DistributedTaskManager` tracks status (`advertised`, `assigned`, `executing`,
  `completed`, `failed`, `cancelled`), retries transient failures, and invokes a
  registered rollback handler when exhausted.
- `execute()` validates the `requestedBy` node against the active `NodePolicy`
  before any handler is invoked. Requests from untrusted (or now-revoked) nodes
  are denied, marked `failed`, and emit an `execute_denied` audit event.
- Audit records are generated for every state change.

## Security Model

1. **Authenticated identity** — Ed25519 keys, stable `nodeId`, identity tamper
   detection on reload.
2. **Encrypted transport** — AES-256-GCM encrypted frames (loopback) with a
   swappable adapter interface for TLS 1.3 / Noise in production.
3. **Authenticated messages** — every message is signed and verified.
4. **Permission enforcement** — `NodePolicy` validates trust, capabilities, and
   required permissions before scheduling or remote execution.
5. **Capability verification** — capability advertisements are unsigned; the
   receiver re-verifies the peer's public key and matches against the local
   `CapabilityRegistry`.
6. **Trust evaluation** — explicit trust states (`unknown`, `untrusted`,
   `community`, `verified`, `official`). No auto-trust.
7. **Replay protection** — nonces and timestamps with bounded deduplication
   windows.
8. **Rate limiting** — the transport's `seenNonces` map and message windows
   provide basic replay and rate control.

## Lifecycle Integration

- `NodeIdentity` registers itself with `LifecycleRegistry` as phase 41.
- `DistributedLifecycle` registers the `Federation` component and each remote
  node, records events, and coordinates snapshots, upgrades, and compatibility
  checks through `UpgradeManager`, `SnapshotManager`, and `CompatibilityManager`.
- Every federation action in `FederationGateway` and `DistributedTaskManager`
  produces an audit record and, when provided, forwards to `LifecycleRegistry`
  and `ObservabilityDashboard`.

## Deployment Examples

### Single-node (backward compatible)

```js
const identity = await new NodeIdentity({ dataPath: './data' }).init();
const mesh = new NodeMesh({ identity, transport: null });
await mesh.start();
```

Without a transport, the mesh operates in purely local mode and `DistributedCompute`
continues to work as before.

### Two-node loopback federation

```js
const { alice, bob } = createLinkedPair(); // NodeIdentity + LoopbackTransport
await alice.mesh.start();
await bob.mesh.start();
alice.mesh.connect(bob.identity.nodeId, bob.identity.publicKey, 'loopback://bob', {
  cpu: 2, ram: 4, capabilities: ['general', 'gpu']
});
```

### Static peer list

```js
const discovery = new NodeDiscovery({
  identity,
  staticPeers: [
    { nodeId: 'peer-1', host: '10.0.0.2', port: 9000, publicKey: '-----BEGIN PUBLIC KEY-----...' }
  ]
});
```

## Operator Guide

- Start a node with `mesh.start()`.
- Add trusted peers with `nodeIdentity.setTrust(nodeId, 'verified')`.
- Connect with `mesh.connect(nodeId, publicKey, address, nodeInfo)`.
- Advertise tasks with `taskManager.advertise(task)`.
- Monitor with `federationDashboard.render()` or `mesh.healthCheck()`.
- Review memory conflicts with `sharedMemoryStore.getConflicts(namespace)`.

## Recovery Procedures

- **Identity mismatch on reload** — `NodeIdentity` throws `*_mismatch`; the
  operator must restore the correct `node-identity.json` or regenerate identity.
- **Partitioned peer** — `NodeMesh` emits `mesh_partition` events. Messages for
  disconnected peers are not queued in this implementation; the outbox is a known
  future enhancement.
- **Task failure** — `DistributedTaskManager` retries up to `maxRetries` and
  then invokes a `type:rollback` handler.
- **Memory conflict** — unresolved conflicts are stored in
  `SharedMemoryStore.conflicts`. Operators call `resolveConflict(namespace, key,
  chosenValue)`.
- **Snapshot before upgrade** — `DistributedLifecycle.prepareSnapshot()` creates
  a snapshot through the existing `SnapshotManager`.

## Known Limitations

- The default transport is an in-memory loopback. A real socket/Noise/TLS
  adapter must be implemented for LAN or internet deployments, but the
  `NodeTransport` adapter interface is already designed for this.
- mDNS discovery is abstracted but not fully implemented; it is simulated by
  events and static/manual peers.
- Partition outbox and deferred sync are acknowledged but not yet implemented in
  `FederationGateway`.
- Byzantine fault tolerance and consensus are beyond the scope of this phase.

## Validation

Run the Phase 41 validation suite:

```bash
npm run federation-test
npm run node-discovery-test
npm run transport-test
npm run scheduler-test
npm run shared-memory-test
npm run lifecycle-test
npm run marketplace-test
npm run rollback-test
npm run typecheck
npm test
```

All commands passed during implementation.
