# Phase 25 — Persistence Audit

## Scope

This audit verifies that HYDI's operating memory survives a restart and does not
lose operational truth.

| Store | File | Contents |
|-------|------|----------|
| BusinessMemory | `business-memory.json` | Projects, clients, equipment, opportunities, tasks, activities, relationships |
| DecisionOutcomeStore | `decision-outcomes.json` | Recommendations and observed outcomes |
| AuditLedger | `audit-ledger.json` | Append-only, hash-chained audit records |
| ExecutiveOperatingSystem | `executive-os.json` | Last briefing and recent decisions |
| SessionMemory | `session-memory.json` | Operator focus, recent commands, conversation history |
| ExecutionGateway | `execution-gateway.json` | Execution log and pending approvals |

## Verification

### Decisions

`DecisionOutcomeStore` loads `decision-outcomes.json` on start. All
recommendations and owner decisions are restored by `recommendationTracker`.

### Recommendations

Recommendations are persisted in the same store. Restart restores the full set,
including `confidenceHistory` and `observedOutcome`.

### Audit History

`AuditLedger` loads records and re-verifies the hash chain on demand. Tampered
files are not accepted as healthy.

### Learning State

Learning is derived from persisted recommendations and outcomes. No separate
learning state file exists; rebuilding from measured outcomes is intentional so
corrupt inference can never survive.

### Operator History

`SessionMemory` restores `recentCommands` and `conversationHistory` on restart.

## Continuity Test

A test run was performed:

1. Start HYDI.
2. Emit business signals and record a recommendation with a measured outcome.
3. Shut down cleanly.
4. Restart HYDI in the same data directory.
5. Confirm the recommendation, audit records, and memory entities are present.

Result: all persisted stores loaded correctly. Corrupt files were archived and
started fresh.

## Notes

- All writes use temp-file/rename for atomicity.
- Corrupt stores are renamed with `.corrupt.<timestamp>` before starting fresh.
- Maximum outcome history is capped at 5000 entries to bound file growth.
