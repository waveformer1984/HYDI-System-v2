# Security Review

## Method

Static review of HYDI v3 security-relevant modules and ArchitectureGuard invariants. No live penetration testing was performed.

## Findings

### Authentication

- `requireAuth.js` resolves device tokens to roles and rejects revoked/missing credentials.
- `deviceAuth.test.js` passes signature round-trips and revocation checks.
- **Status:** acceptable

### Authorization

- `NodePolicy.validateAction` filters tasks by trust and required capabilities.
- `rbac.hasPermission` fails closed on unknown roles/permissions.
- `requireAuth` returns 403 for insufficient role permissions.
- **Status:** acceptable

### Trust Boundaries

- `FederationGateway` uses `NodePolicy` before remote execution.
- `DistributedTaskManager.execute()` validates `task.requestedBy` against `NodePolicy`.
- `ArchitectureGuard` invariant `exec-passes-policy` passes.
- **Status:** acceptable

### Replay Protection

- `AuditLedger` is append-only and hashed.
- `LifecycleRegistry.recordProposal` records every state change.
- `FederationGateway` now enforces message `id`, `timestamp` and `expiresAt` with a configurable replay window.
- Duplicate messages are rejected and audited.
- Expired messages are rejected and audited.
- Tests in `FederationReplay.test.js` cover acceptance, expiry, duplicate, pruning and audit.
- **Status:** resolved in rc.2

### Plugin Permissions

- `CapabilitySandbox` enforces declared permissions.
- Runtime test in `ArchitectureGuard` passes: allowed, denied and undeclared permissions handled correctly.
- **Status:** acceptable

### Federation Messaging

- `FederationGateway._receiveRemoteExecute` validates through `policy.validateAction`.
- Audit record emitted for every routed message.
- **Status:** acceptable

### Lifecycle & Upgrades

- `LifecycleRegistry` records every proposal.
- `DeploymentManifest` and `SnapshotManager` support upgrade/rollback verification.
- `verify` and `snapshot` CLI commands pass.
- **Status:** acceptable

### Capability Installation

- `MarketplaceManager` uses `SignatureVerifier`.
- `CapabilityInstaller` triggers through the marketplace.
- **Status:** acceptable

## Severity Summary

| Severity | Count |
|----------|-------|
| High | 0 |
| Medium | 0 |
| Low | 0 |

## Conclusion

No high, medium or low severity findings remain. The federation message replay hardening opportunity has been implemented and validated.
