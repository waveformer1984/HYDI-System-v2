# Phase 5 — identity-bound execution and tenant isolation

## Integration base

- Stacked on Phase 4 PR #370 (`Cusor_agent01execution-fabric-phase4-1ec4`), which is still an open draft.
- Billing PRs **#368** and **#369** are **not** merged into this branch.
- `origin/clean-main` remains `6b48baa7` until those drafts merge.

## Principal

Tasks store:

- `created_by` — authenticated subject from the server (`device id` or role), never a body field.
- `tenant_id` — only when a trusted resolver supplies it. Device pairing alone does not set a billing tenant.
- HTTP `body.tenant_id` / `args.tenant_id` are ignored.

## Access rules (`lib/execution-fabric/access.js`)

| Task tenant | Caller tenant | Result |
|-------------|---------------|--------|
| A | A | allow |
| A | B | not found (no leak) |
| A | unbound | `tenant_binding_required` |
| NULL (legacy / unknown) | any tenant | not found — **not claimable** |
| NULL | unbound | allow (pre-Phase-5 operator tasks) |

Idempotency scope is `tenant:<id>` when a tenant is bound, else `mobile-ops`.

## Approval

Sensitive capabilities record `authorization.expires_at` (15 minutes). Expired approval transitions to `NEEDS_HUMAN` and does not execute. Permission is re-checked at approval time; revocation also yields `NEEDS_HUMAN`.

## Billing

`lib/execution-fabric/billing-verification-adapter.js` evaluates evidence fail-closed (missing, stale, mismatched tenant, indeterminate → reconciliation, no second charge). It does **not** call Stripe. `runVerifiedBillingExecution` from #368 is used only if that module exists on disk; on this branch it does not, so `integrationStatus().disposition` is `blocked_pending_pr_368`.

## Control permission

Approving, cancelling and resuming (retrying) a fabric task requires
`fabric:control`, which only `owner` and `operator` hold. `viewer` keeps
`status:view` for reading tasks but is refused on every control path: the
`ops.task_approve` / `ops.task_cancel` / `ops.task_resume` catalog actions,
the `approve` / `retry` / `cancel` requests on `/api/mobile-ops/fabric`, and
the gateway and orchestrator methods themselves. A refused control attempt
leaves the task untouched; only an approver who holds `fabric:control` but
lacks the task's recorded capability permission moves it to `NEEDS_HUMAN`.

## RLS

`execution_fabric_tasks` is accessed with the Supabase **service role**, whose policy is `USING (true)`. That does **not** provide tenant isolation. Isolation is the application check plus the ownership trigger in `20261015180000_execution_fabric_tenant_binding.sql`. Do not treat service-role queries as an RLS proof.

## Rollback

```sql
DROP TRIGGER IF EXISTS execution_fabric_lock_ownership ON public.execution_fabric_tasks;
DROP FUNCTION IF EXISTS public.execution_fabric_lock_ownership();
ALTER TABLE public.execution_fabric_tasks DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.execution_fabric_tasks DROP COLUMN IF EXISTS created_by;
```

Dropping columns discards ownership metadata. Apply only when no tenant-scoped tasks must be retained.
