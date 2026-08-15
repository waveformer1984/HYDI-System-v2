# HYDI Phase 12 — Audit Persistence Design

## Current State

Before Phase 12, the control plane had:

| Component | Storage | Survives Restart |
|---|---|---|
| `AuditLog` | in-memory array | no |
| `ApprovalManager` | in-memory `Map` | no |
| `pao-system/core/audit.log.ts` | not wired into the executive path | no |
| `RecoveryEngine` history | in-memory array | no |
| `event bus` | in-memory pub/sub | no |
| `HeidiExecutive` state | in-memory | no |
| Rezonate `actions` table | Supabase/local DB | yes |
| Worker events | Supabase/local DB queue | yes |

## Design Decision

Use the existing `src/heidi-executive/AuditLog.js` and `ApprovalManager.js` as the canonical control-plane audit and approval stores. Extend them to persist to local `data/` directories:

- `data/audit.jsonl` — one immutable line-delimited JSON record per event.
- `data/approvals.json` — current approval state as compact JSON.

This is the smallest extension that meets the requirements and does not create a second event/audit architecture.

## Record Schema

```json
{
  "timestamp": 1723766400000,
  "taskId": "recover-supabase_inbucket-...",
  "capabilityId": "health.recover",
  "actor": "heidi",
  "target": "local",
  "inputs": { "service": "supabase_inbucket" },
  "approvalState": { "decision": "auto" },
  "executionResult": { "success": true, "result": "..." },
  "verificationResult": null,
  "duration": 234,
  "error": null,
  "resultingState": "COMPLETED"
}
```

## Safety Properties

- `AuditLog.record()` redacts inputs through `SecretBroker` before storage.
- Secrets are never persisted in the audit trail.
- Corrupted lines are skipped on reload; valid records remain.
- Approval state is rewritten atomically (within a single `writeFileSync`).
- No `DELETE` or mutable update of audit records is provided.

## Files Modified

- `src/heidi-executive/AuditLog.js`
- `src/heidi-executive/ApprovalManager.js`
- `src/heidi-executive/HeidiExecutive.js` (accepts `dataDir` option)
- `src/heidi-executive/index.js` (exports)

## Tests

`tests/unit/heidi-executive/phase12-autonomous.test.js`:

- records an event
- new `AuditLog` instance recovers the event
- new `ApprovalManager` instance recovers the approval state
- secret-shaped inputs are redacted
