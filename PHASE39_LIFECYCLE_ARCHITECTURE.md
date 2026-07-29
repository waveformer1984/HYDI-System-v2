# Phase 39 — HYDI Lifecycle Operating System

## Purpose

Phase 39 transforms HYDI from an evolving AI framework into a self-governing,
versioned operating environment. It provides controlled upgrades, reproducible
deployments, plugin isolation, and recovery-aware lifecycle management for every
HYDI subsystem.

## Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| LifecycleRegistry | `src/hydi-v3/LifecycleRegistry.js` | Authoritative registry of every subsystem, its version, health, dependencies, permissions, and rollback snapshot. |
| CompatibilityManager | `src/hydi-v3/CompatibilityManager.js` | Validates version compatibility and dependency graphs; returns `compatible`, `warning`, or `blocked`. |
| SnapshotManager | `src/hydi-v3/SnapshotManager.js` | Captures and restores point-in-time snapshots that include registry state, configuration, model and agent state, and memory metadata. |
| PluginRuntime | `src/hydi-v3/PluginRuntime.js` | Isolates plugins with declared permissions across filesystem, network, execution, memory, external APIs, and hardware. |
| DeploymentManifest | `src/hydi-v3/DeploymentManifest.js` | Declarative manifest for complete system recreation and verification. |
| UpgradeManager | `src/hydi-v3/UpgradeManager.js` | Orchestrates the seven-stage upgrade lifecycle. |
| EvolutionProposal | `src/hydi-v3/EvolutionProposal.js` | Tracks every proposed change, its rationale, risk, rollback plan, and approval state. |
| LifecycleDashboard | `src/hydi-v3/LifecycleDashboard.js` | Aggregates lifecycle status, upgrade history, snapshot health, compatibility state, and plugin permissions. |

## Upgrade Lifecycle

```
DISCOVER
    ↓
ANALYZE
    ↓
SNAPSHOT
    ↓
SIMULATE
    ↓
UPGRADE
    ↓
VALIDATE
    ↓
COMMIT
```

1. **DISCOVER**: `UpgradeManager.discover()` identifies candidate version bumps.
2. **ANALYZE**: `CompatibilityManager` and `EvolutionProposal` evaluate risk.
3. **SNAPSHOT**: `SnapshotManager.create('pre-upgrade')` captures the current
   operational state.
4. **SIMULATE**: The upgrade plan is exercised in a safe, side-effect-free pass.
5. **UPGRADE**: The component version is updated and recorded.
6. **VALIDATE**: Health checks confirm the upgraded subsystem is operational.
7. **COMMIT**: The upgrade is finalized and emitted as an auditable event.

If any stage fails, the orchestrator can restore the pre-upgrade snapshot and
roll the subsystem back to its previous version.

## Rollback Process

1. `UpgradeManager` records the pre-upgrade snapshot hash before mutation.
2. On failure, the lifecycle stops at the failed stage.
3. If `autoRollback` is enabled, `SnapshotManager.restore('latest')` is invoked.
4. `LifecycleRegistry` reverts the affected component version.
5. An `upgraded`/`rollback` event is emitted for telemetry.

## Plugin Security Model

Plugins fail closed. Every plugin must declare:

- `name` and `version`
- `capabilities`
- `permissions` per domain
- `resourceLimits`

Permission domains: `filesystem`, `network`, `execution`, `memory`, `externalApis`, `hardware`.

`PluginRuntime.execute(plugin, domain, action)` returns `permission_denied` if
the plugin has not explicitly declared the requested permission. Permissions may
be revoked but never expanded dynamically without a new registration and
operator approval.

## Deployment Workflow

A `DeploymentManifest` describes a complete HYDI environment:

- `runtimeVersions`
- `services` and `ports`
- `models`
- `databases`
- `environment` variables
- `agents`
- `plugins`
- `configuration`
- `components`

Operators can:

- `hydi export-manifest` to serialize the current system.
- `hydi bootstrap <manifest>` to recreate a system from a manifest.
- `hydi verify <manifest>` to confirm the running system matches the manifest.
- `hydi deploy <manifest>` to apply a manifest to the current registry.

## Operator Procedures

### Snapshot a running system

```bash
hydi snapshot create --label pre-release
```

### List snapshots

```bash
hydi snapshot list
```

### Restore a snapshot

```bash
hydi snapshot restore --hash <sha256>
```

### Compare two snapshots

```bash
hydi snapshot compare --a <hash1> --b <hash2>
```

### Propose and run an upgrade

```bash
npm run lifecycle-test
npm run upgrade-simulation
npm run rollback-test
```

### Verify plugin security

```bash
npm run plugin-security-test
```

### Rebuild from manifest

```bash
npm run deployment-rebuild-test
```

## Integration with Prior Phases

- Phase 36 observability feeds `LifecycleDashboard` health and telemetry.
- Phase 37 adaptive optimization data is captured in lifecycle snapshots.
- Phase 38 resilience and recovery mechanisms are reused by `UpgradeManager`
  rollback and `SnapshotManager` integrity checks.

## Testing

Phase 39 validates:

- `npm run lifecycle-test`
- `npm run upgrade-simulation`
- `npm run rollback-test`
- `npm run plugin-security-test`
- `npm run deployment-rebuild-test`

The acceptance suite (`scripts/phase39-acceptance.js`) executes every scenario
and writes `reports/business-os/phase39-lifecycle-report.md`.
