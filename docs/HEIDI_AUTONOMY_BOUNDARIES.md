# HEIDI Autonomy Boundaries

## Purpose

Explicit, enforced, and tested boundaries for autonomous operational actions. HEIDI's autonomy is capability-based and fail-closed.

## Capability matrix

| Capability | Autonomous | Approval Required | Forbidden |
|---|---|---|---|
| Health probe | Yes | No | No |
| Collect diagnostics (`heidi diagnose`) | Yes | No | No |
| Report status | Yes | No | No |
| Restart application process | Yes | No | No (manifest) |
| Restart bounded container (`wsl_docker.local`) | Yes | No | No |
| Restart bounded compose service (`wsl_compose.local`) | Yes | No | No |
| Restart infrastructure runtime (WSL/Docker daemon) | Conditional | Yes | No |
| Delete container | No | Yes | No |
| Delete volume | No | Yes | Yes |
| `docker prune` | No | Yes | Yes |
| Change host networking / firewall | No | Yes | Yes |
| Modify credentials | No | Yes | Yes |
| Modify security policy | No | Yes | Yes |
| Arbitrary shell execution | No | Yes | Yes |
| Production deployment | No | Yes | Yes |
| Destructive database operation | No | Yes | Yes |

## Enforcements

1. `CapabilityRegistry` rejects unregistered capabilities.
2. `PolicyEngine` blocks any capability not on the allowlist.
3. `ApprovalManager` requires an external approver for CRITICAL actions.
4. `ControlledExecutor` and `WslExecutor` validate `operation` + `resource` against explicit allowlists.
5. `SecretBroker` redacts raw credentials in audit and incident records.
6. `IncidentStore` is append-only; HEIDI cannot rewrite operational history.

## Exception handling

If a task is not on the allowlist, the action is `DENIED` and an incident record is created. No hidden fallback paths exist.
