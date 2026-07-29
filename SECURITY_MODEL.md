# HYDI Security Model

## Trust Layers

### Node Policy

- Every remote execution request is validated by `NodePolicy`.
- `NodePolicy` rejects actions from untrusted or revoked nodes.
- `DistributedTaskManager.execute()` validates `task.requestedBy` against policy.

### Federation

- Nodes authenticate before joining.
- Trust is established explicitly, not derived from network membership.
- `FederationGateway` records every action in the audit ledger.

### Marketplace

- Capabilities must be signed.
- `SignatureVerifier` checks publisher trust.
- `CapabilitySandbox` enforces declared permissions.
- Undeclared permissions are denied by default.

### Governance

- Autonomous actions require policy validation.
- `ApprovalCenter` gates mutating operations.
- `DecisionJournal` records strategic decisions.
- `LifecycleRegistry` records every lifecycle change.

### Audit

- `AuditLedger` is append-only and hashed.
- `ArchitectureGuard` continuously verifies invariants.
- `SecurityAuditor` performs periodic static security checks.

## Non-Goals

This release does not provide operating-system-level sandboxing for plugins.
Containerized or seccomp-based isolation should be added at deployment time.
