# Phase 26 — Human Operations Report

## Objective

Improve operator interaction quality so HYDI becomes a practical daily
operating assistant.

## Operator Workflow

See `phase26-daily-operator-loop.md` for the full daily, weekly, and end-of-day
workflow.

Summary:

- Morning: start HYDI, review the executive briefing, review risks, approve or
  reject review-required actions.
- Midday: review changes, check unresolved recommendations, record measured
  outcomes.
- End of day: review completed actions, confirm outcomes, review what HYDI
  learned.
- Weekly: review strategic trends, confidence changes, and recurring risks.

## Command Improvements

### New CLI commands

- `hydi health` — component-level health report with warnings and failures.
- `hydi outcome <id> --result <successful|unsuccessful|unknown> --value <n> --source <text> --notes <text>` — operator-recorded outcome with measured value and provenance.
- `hydi memory-review` — human-readable memory review: recent decisions,
  actions, measured outcomes, confidence changes, and lessons.
- `npm run hydi:operator-demo` — scripted realistic ProtoForge day.

### Existing commands improved

- `explain approval <id>` now shows:
  - Recommendation
  - Why it exists
  - Expected outcome
  - Business impact
  - Risk
  - Undo path
  - Audit consequences
  - Evidence
  - Confidence
  - Responsible agent

- `approve <id>` now warns if the approval is stale (> 1 hour old), so an
  operator cannot accidentally approve an out-of-date recommendation.

## Approval Flow

`tests/integration/hydi-operator-approval-flow.test.js` proves the chain:

```
recommendation → explanation → approval → execution → audit
```

The `ApprovalCenter.explain` method now surfaces evidence, undo path, and audit
consequences before any approval. `approve` still delegates to
`ExecutionGateway`, which is the only authority that can execute. Audit entries
`action-approved` and `action-executed` are recorded.

## Measurement Capture

The `hydi outcome` CLI enforces measurement discipline:

- Qualitative confirmation (`--result successful` without `--value` and
  `--source`) is recorded but cannot move learning confidence.
- Numeric evidence only affects learning when both `--value` and `--source` are
  provided, so provenance is always attached.
- Conflicting measurements are rejected unless `supersede` is set.

This matches the learning rule: measured outcomes can affect learning;
unmeasured, simulated, and unknown cannot.

## Discovered Usability Issues

| Issue | Fix |
|-------|-----|
| `explain approval` did not show evidence, undo path, or audit consequences | Added to `ApprovalCenter.explain` and `ConversationEngine._explainApproval` |
| `review <id>` conflates measurement with approval | Added `hydi outcome` CLI for explicit measurement capture |
| No human-readable memory review | Added `hydi memory-review` CLI |
| No stale-approval guard | `ApprovalCenter.approve` now warns for approvals older than 1 hour |
| No single realistic operator demo | Added `npm run hydi:operator-demo` |

## Validation Results

| Command | Result |
|---|---|
| `npm run typecheck:hydi-v3` | pass |
| `npm run lint:hydi-v3` | pass (0 errors) |
| `npm test` | pass — 203 suites, 2,046 tests |
| `npx jest --testMatch="<rootDir>/tests/integration/**/*.test.js"` | pass — 11 suites, 58 tests |
| `npm run hydi:operator-demo` | completed realistic assistant interaction |

## Success Condition

A person unfamiliar with HYDI can now:

1. Start it with `npm run hydi:status` or `npm run hydi:operator-demo`.
2. Understand the briefing from `good morning` or the demo output.
3. Approve a safe action using `show approvals` and `approve <id>` after reading
   `explain approval <id>`.
4. Record the outcome with `hydi outcome <id> --result ... --value ... --source ...`.
5. Understand what HYDI learned with `hydi memory-review` or `learning`.

All proven by the integration tests and the operator demo.
