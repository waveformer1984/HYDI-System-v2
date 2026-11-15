# HYDI multi-agent development workforce

**Execution authority:** `ExecutionGateway` only.  
**Implementation:** `lib/dev-workforce/{types,registry,coordinator}.js`

## Agent roles (`AGENT_ROLES`)

Chief Architect, Software Engineer, Security Engineer, Research Analyst, Business Development, Finance Analyst, Freelance Discovery, QA, Infrastructure, Operations, Documentation, Executive Orchestrator.

## Permissions model

Permissions are **explicit lists** per agent — registration does **not** grant root access.

| Permission | Meaning |
|------------|---------|
| `fabric:submit` | May call `gateway.submit` for allowlisted capabilities |
| `fabric:control` | Operator-level fabric control (orchestrator) |
| `status:view` | Read-only diagnostics capabilities |
| `ops:diagnostics` | e.g. `git.inspect`, bounded tests |
| `revenue:read` | Read revenue snapshots (no spend) |
| `external:draft` | Draft-only external content — **not send** |

## Task lifecycle

```text
register(agent) → assign(capabilityId) → ExecutionGateway FSM
  → AWAITING_APPROVAL (if confirmRequired) → COMPLETED / FAILED
  → evidence on task row (fabric store)
```

## Human approval gates

- Fabric capabilities with `confirmRequired: true` (e.g. `tests.run`)  
- ProtoForge / mission approvals for autonomous actions  
- `paid-llm-gate` for any paid model  

## Failure reporting

Failed `assign()` returns `{ error, classification }` without side effects on unregistered agents.

## Tests

`tests/unit/dev-workforce-coordinator.test.js`

## Future work (blockers)

| Item | Classification |
|------|----------------|
| HTTP API for workforce registration | **CONFIGURED BUT UNTESTED** |
| Persist registry in Postgres | **BLOCKED** (no migration in this mission) |
| Mobile UI for agent roster | **CONFIGURED BUT UNTESTED** |

**Classification:** VERIFIED SIMULATED (in-memory fabric store tests)