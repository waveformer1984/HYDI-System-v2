# HYDI Operator Manual

## Starting HYDI

Run one of the following commands in the project root:

```bash
npm run hydi:status       # one-time operating state snapshot
npm run hydi:continuous-demo  # walk through a full business cycle
npm run cockpit           # interactive operator console
```

HYDI boots from the `data/` directory unless `--data-path <dir>` is given.

## Understanding Status

`npm run hydi:status` prints an operating state block:

| Field | Meaning |
|-------|---------|
| Runtime | `READY`, `DEGRADED`, `RECOVERING`, or `STOPPED` |
| Uptime | How long HYDI has been running in milliseconds |
| Events processed | Number of business events seen |
| Recommendations | Tracked recommendations from the executive layer |
| Pending approvals | Actions waiting for operator approval |
| Awaiting measurements | Recommendations whose outcome has not yet been measured |
| Audit entries | Total records in the audit ledger |
| Learning updates | Recommendations with measured outcomes used for learning |
| Last verified action | Most recent completed action from the execution gateway |

Warnings and failures are listed below the state block.

## Interpreting Confidence

- A recommendation's confidence is computed from the quality and completeness
  of its underlying data.
- Confidence only changes when measured evidence is evaluated.
- Simulated or unmeasured outcomes cannot change confidence.
- Unknown or missing provenance reduces confidence.

## Approving Actions

`ExecutionGateway` classifies actions as autonomous, review-required, or
forbidden. Review-required actions appear in `Pending approvals`.

In the `cockpit`, approve with:

```
approve <action-id>
```

Reject with:

```
reject <action-id>
```

Forbidden actions such as `send-email`, `commit-code`, and `purchase` are never
approved; they are rejected automatically.

## Reviewing Audit

The audit ledger is append-only and hash-chained. Inspect it via the operator
console or directly in `data/audit-ledger.json`.

Look for these categories:

- `action-executed` — a safe action completed
- `action-approved` — operator approved a review-required action
- `action-failed` — an action failed and recorded negative evidence
- `malformed-event-ignored` — an event was ignored safely
- `startup-report` — boot status

## Handling Degraded States

If `Runtime` is `DEGRADED`:

1. Read the warnings.
2. Common causes: a sensor offline, signal coverage warnings, or a broken audit
   chain.
3. HYDI continues to run degraded; it does not invent healthy status.
4. Resolve the root cause and wait for the next health check, or restart.

## Recovery Procedures

- Restart HYDI after fixing a sensor or data source. Persistence files are
  loaded on start.
- If a store file is corrupt, HYDI archives it and starts fresh. Move the
  `.corrupt.<timestamp>` file for inspection.
- If the audit chain is broken, HYDI refuses to report `READY` until the ledger
  is restored or the data directory is reset.
