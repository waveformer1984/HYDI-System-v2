# Phase 4 — operational task contract

## Canonical lifecycle (execution fabric)

Internal states (`lib/execution-fabric/constants.js`):

| Internal | Mobile / operator alias |
|----------|-------------------------|
| `QUEUED` | `proposed`, `queued` |
| `PLANNING` | `queued` |
| `AWAITING_APPROVAL` | `awaiting_approval`, `needs_human` |
| `NEEDS_HUMAN` | `needs_human` (infra/operator block) |
| `RUNNING` | `running` |
| `VERIFYING` | `verifying` |
| `BLOCKED` | `blocked` |
| `RECOVERING` | `running` (recovery) |
| `COMPLETED` | `succeeded` |
| `FAILED` | `failed` |
| `CANCELLED` | `cancelled` |

## Required fields

- `id` (task_id), `correlation_id`, `capability_id` / `objective_id`
- `state`, transition history (`steps` / plan steps)
- `idempotency_key`, `attempt_count`, lease fields
- `authorization`, `verification` (independent of executor `outcome.ok`)
- `outcome`, `errors`, `recovery` hints

## Invariants

1. **No success without verification** — `COMPLETED` only after `VERIFYING` + contract pass.
2. **Idempotency** — same key returns same task without re-execution.
3. **Approval ≠ blanket authority** — each capability re-checks permission at execution time.
4. **Cancellation** — does not undo external side effects already committed.

## Autonomy levels (policy mapping)

| Level | Behavior |
|-------|----------|
| 0 Observe | `health.check`, `ops.task_status`, readiness |
| 1 Recommend | Objectives validated but not executed without submit |
| 2 Approved | `confirm: true` on gated capabilities |
| 3 Bounded | Idempotent sync reads + rate limits |
| 4 Sensitive | `tests.run`, billing admin, offboarding — always confirm + permission |
