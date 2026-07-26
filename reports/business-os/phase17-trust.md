# Phase 17 — Trust, Provenance & Justifiable Decisions

Date: 2026-07-25
Branch: clean-main

## Goal

Shift HYDI from a system the operator must trust implicitly to one that can **justify** every recommendation and action. Before any external business system is connected, HYDI must be able to answer:

- Why am I recommending this?
- Why is it safe?
- What data did I use?
- What assumptions did I make?
- What would happen if I executed it?
- What changed afterward?
- Can I undo it?

## New Modules

### `src/hydi-v3/AuditLedger.js`

An append-only, hash-chained event ledger. Every record contains:

- `id`, `at`, `category`, `actor`, `subjectId`
- `payload` (arbitrary action/audit context)
- `previousHash` and `hash`

No record is modified after write. `verify()` walks the chain and detects any tampering with `previous-hash-mismatch` or `record-hash-mismatch`. Persistence is atomic (temp-file + rename) and debounced.

### `src/hydi-v3/TrustEngine.js`

- `computeConfidence(entity)` — scores 0-1 based on field completeness, normalized values, and freshness.
- `generateProvenance(recommendation, memory)` — returns `{ sources, assumptions, reasoning, confidence }`.
- `iDontKnow(reason)` — returns a zero-confidence recommendation with explicit "I don't have enough reliable information" action.
- `formatJustification(recommendation, adapters)` — renders the seven trust questions as executive text.
- `canUndo(action, adapters)` — checks whether the responsible adapter exposes an `undo` capability.

### `src/hydi-v3/ActionSnapshot.js`

- `capture(memory, query)` — serializes a subset of `BusinessMemory`.
- `diff(before, after)` — computes `added`, `removed`, and `modified` entities.

## Integration Points

### `ExecutionGateway`

- Now owns an `AuditLedger` instance, started/stopped/flushed with gateway lifecycle.
- Every `execute`/`approve`/`reject`/`await-approval` records an immutable `AuditLedger` event.
- `_runEntry` captures `beforeState` before the adapter runs and `afterState` after, then computes and stores the `diff`.
- Added `getAuditTrail(query)` and `verifyAuditChain()` query methods.
- Already honoured `simulate` in `approve()`; the existing `ExecutionGateway simulate flag` test passes, confirming the prior safety fix is preserved.

### `ExecutiveOperatingSystem`

- Added `TrustEngine` instance.
- `recommendations()` now includes `confidence` and `provenance` on every recommendation.
- When no actionable data exists, the list returns one `iDontKnow` entry instead of fabricating advice.
- Recommendations include `expectedOutcome` and `changes` fields so `ConversationEngine` can explain consequences.

### `ConversationEngine`

- `_explainRecommendation()` now prints confidence, data sources, assumptions, expected outcome, expected changes, and undoability, in addition to the existing rationale.

## Test Coverage

| Test file | Coverage |
|---|---|
| `tests/unit/hydi-v3/AuditLedger.test.js` | Immutable recording, hash chaining, tamper detection, query filtering |
| `tests/unit/hydi-v3/TrustEngine.test.js` | Confidence scoring, provenance generation, `iDontKnow`, justification format |
| `tests/unit/hydi-v3/ActionSnapshot.test.js` | Capture and diff (add/remove/modify) |
| `tests/unit/hydi-v3/ExecutionGateway.test.js` | Audit history, simulate flag, lifecycle |
| `tests/unit/hydi-v3/ExecutiveOperatingSystem.test.js` | Recommendations with provenance |
| `tests/unit/hydi-v3/ConversationEngine.test.js` | `explain recommendation` still works |

## Validation

| Gate | Command | Result |
|---|---|---|
| Type validation | `npm run typecheck` | PASS |
| Lint validation | `npm run lint:hydi-v3` | PASS (0 errors) |
| Full regression suite | `npm test` | **PASS — 179/179 suites, 1,849/1,849 tests** |
| Performance validation | `npm run benchmark:performance` | PASS |

## Safety Audit Findings

| Question | Answer |
|---|---|
| Can an operator believe they are simulating while real side effects happen? | No. `ExecutionGateway.approve()` passes the gateway-wide `simulate` flag, and `OperatorMode` dry-run tests explicitly assert no completed execution is recorded. |
| Can an action's history be silently altered? | No. `AuditLedger` records are hash-chained; `verify()` detects tampering. |
| Can HYDI recommend an action with no data? | It can, but it now returns `iDontKnow` with `confidence: 0` and explicit provenance. |
| Can a recommendation explain its own sources? | Yes. Every recommendation carries `provenance.sources` and `provenance.assumptions`. |
| Can an operator see what changed after an execution? | Yes. `ExecutionGateway` stores `beforeState`, `afterState`, and `diff` in the audit record. |

## Remaining Work

- `ExecutionGateway` adapters do not yet implement `undo` methods; `canUndo()` returns `false` for all current adapters. Once file-state rollback is needed, add `adapter.undo()` to the adapter interface and `canUndo: true`.
- `TrustEngine.computeConfidence()` freshness threshold is fixed at 30 days. Make it configurable per entity type in a future refinement.
- `ActionSnapshot` currently snapshots `id`, `type`, `name`, `status`, `value` only. Expand to full payload when required for financial or contractual actions.
- Recommendations do not yet persist provenance into the audit log. In the next phase, every accepted recommendation should become an `AuditLedger` record with subject chaining.

## Recommended Next Milestone

**External Integration Dry-Run Layer** — add a `DryRun` mode for every adapter that mirrors the real target API contract without making external calls, and store the mirrored request/response in `AuditLedger` as `external-simulation` events. Only after dry-run parity is proven should live external endpoints be wired in.

## Commit Status

Pending commit. Working tree contains `CHANGELOG.md` update and the new report.
