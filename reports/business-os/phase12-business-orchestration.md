# Phase 12 — Business Orchestration Engine

Date: 2026-07-25
Branch: clean-main

## Implementation Summary

Added `src/hydi-v3/BusinessWorkflowEngine.js` and `BusinessValueScorer` to turn Executive Operating System recommendations into prepared, approval-gated, agent-assigned operational workflows.

## Architecture

```
BusinessMemory (world model)
    ↓
ExecutiveOperatingSystem (briefings, recommendations)
    ↓
BusinessWorkflowEngine (recommendation → workflow → TaskEngine)
    ↓
TaskEngine (execution)
    ↓
BusinessMemory (outcome/lesson)
```

No duplicate task management: `BusinessWorkflowEngine` plans and gates workflows; `TaskEngine` executes the top-level workflow task.

## Workflows Implemented

| Type | Default Steps | Auto-Approve Threshold |
|---|---|---|
| `sales` | gather requirements → draft quote → review pricing → prepare communication → await approval → track outcome | value < 500 |
| `manufacturing` | material check → schedule equipment → produce → quality review → notify completion | value < 200 |
| `research` | plan experiment → track prototype → document results → capture knowledge | always |
| `creative` | plan project → organize assets → prepare release → manage pipeline | always |
| `finance` | review financials → identify leakage → recommend action | always |
| `technical` | assess system → prioritize debt → plan maintenance | always |

Sales/manufacturing/finance workflows above the threshold require `approveWorkflow()` before `startWorkflow()`.

## Agent Behavior

- `getRankedRecommendations()` uses `ExecutiveOperatingSystem.morningBriefing()` and scores each recommendation by `BusinessValueScorer`.
- `createWorkflowFromRecommendation()` infers workflow type from the recommendation text and assigns the right executive agent.
- `getPreparedActions()` surfaces the next executable step for the top non-terminal workflows.
- `recordOutcome()` compares expected and actual value and writes a `lesson` entity into `BusinessMemory`.

## Tests Added

`tests/unit/hydi-v3/BusinessWorkflowEngine.test.js` (12 tests):
- lifecycle
- workflow creation with typed steps
- unknown workflow type fallback
- approval gate for high-value sales
- auto-approval for research
- recommendation-to-workflow conversion
- `getPreparedActions()` ranking
- outcome recording and learning entity
- persistence across instances
- corruption recovery
- custom step handlers and failure path
- 100-workflow creation benchmark

## Validation Results

| Gate | Command | Result |
|---|---|---|
| Type validation | `npm run typecheck:hydi-v3` | PASS |
| Lint validation | `npm run lint:hydi-v3` | PASS (0 new issues, 14 pre-existing `no-console` warnings) |
| Full regression suite | `npm test` | PASS — 159/159 suites, 1,638/1,638 tests |
| Performance validation | `npm run benchmark:performance` | PASS |

## Benchmarks

- 100 workflow creations in < 70 ms.
- Full `npm test` in 173 s.
- No measurable regression.

## Limitations

- `BusinessWorkflowEngine` runs workflow steps internally; `TaskEngine` receives one top-level task per workflow. Fine-grained step tracking is not yet mirrored as individual `TaskEngine` tasks.
- Step handlers are configurable but must be provided at construction; there is no built-in library of real business actions.
- Outcome recording is numeric only; qualitative lessons are stored as payloads.
- No automated scheduling or recurrence.

## Next Recommended Milestone

**Unified Operator Dashboard** — expose `getPreparedActions()` and `ExecutiveOperatingSystem.toText()` via a local CLI command or HTTP endpoint so the owner can ask "What should ProtoForge do next?" and receive a prepared operational path.

Alternatives:
1. **Local Backup Automation** — schedule Git bundles and `BusinessMemory`/`BusinessWorkflowEngine` snapshots.
2. **Revenue/Ledger Integration** — ingest live revenue and customer pipeline into `BusinessMemory`.
