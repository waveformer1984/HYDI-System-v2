# Phase 19 – Continuous Learning Framework

## Overview

Implemented HYDI's Continuous Learning Framework so every recommendation,
decision, execution, and outcome improves future executive reasoning. The
framework closes the loop from `BusinessSignal` → `BusinessMemory` →
`ExecutiveOperatingSystem` → recommendation → `ExecutionGateway` → `AuditLedger`
→ outcome → `TrustEngine`, without adding new sensors or direct coupling
between modules.

## Architecture

```
Business Signals
        ↓
Business Memory
        ↓
Executive Operating System
        ↓
RecommendationTracker  (permanent recommendation IDs, lifecycle)
        ↓
Execution Gateway / Business Workflow Engine
        ↓
Business Outcome Engine  (classify + score observed outcomes)
        ↓
Decision Outcome Store   (persistent outcomes, confidence history)
        ↓
Confidence Calibration + Learning Metrics
        ↓
Trust Engine + future Executive OS recommendations
```

Learning is additive. The `AuditLedger` remains immutable; the new store holds
recommendation and outcome records separately.

## Modules

| Module | Path | Responsibility |
|---|---|---|
| `DecisionOutcomeStore` | `src/hydi-v3/DecisionOutcomeStore.js` | Persistent store for recommendations, owner decisions, executions, outcomes, and confidence history |
| `RecommendationTracker` | `src/hydi-v3/RecommendationTracker.js` | Recommendation lifecycle, permanent IDs, delegating persistence to `DecisionOutcomeStore` |
| `BusinessOutcomeEngine` | `src/hydi-v3/BusinessOutcomeEngine.js` | Classifies outcomes, computes revenue/schedule/strategic/operational impacts, calibrates confidence, generates lessons |
| `ConfidenceCalibration` | `src/hydi-v3/ConfidenceCalibration.js` | Adaptive confidence adjustment using a configurable policy |
| `LearningPolicies` | `src/hydi-v3/LearningPolicies.js` | Conservative, Balanced, Aggressive, Experimental policy parameters |
| `LearningMetrics` | `src/hydi-v3/LearningMetrics.js` | Prediction accuracy, success rate, confidence drift, learning velocity, top agents, lowest confidence areas, recommendation history |

## Integration

- `ExecutiveOperatingSystem` now accepts `recommendationTracker` and
  `learningMetrics` in its constructor, records every generated recommendation,
  and includes a `learningSummary` in `morningBriefing()`.
- `TrustEngine` accepts `learningMetrics` and augments provenance/justification
  with historical success rate, prior failures, weakest area, and what would
  change the recommendation.
- `ExecutionGateway` accepts an optional `outcomeEngine` and observes completed
  or failed actions when `recommendationId` is attached to the action.
- `BusinessWorkflowEngine` accepts an optional `outcomeEngine` and feeds workflow
  outcomes through it in `recordOutcome()`.
- `ExecutiveCockpit` exposes a `learning` command and a learning dashboard
  rendered through `LearningMetrics.getDashboardData()`.
- `OperatorSession` constructs and starts `DecisionOutcomeStore`,
  `RecommendationTracker`, `BusinessOutcomeEngine`, and `LearningMetrics`; it
  wires them into the executive stack as described above.
- `BriefingRenderer.toSections()` includes a new `Learning Summary` section when
  `briefing.learningSummary` is present.

## Outcome classification

`BusinessOutcomeEngine.classifyOutcome()` maps observed/expected value ratios to:

- `successful`
- `partially successful`
- `failed`
- `abandoned`
- `cancelled`
- `superseded`

Impacts are computed for revenue, schedule, strategic, and operational
dimensions. Confidence is then adjusted using `ConfidenceCalibration` and a
`LearningPolicies` profile.

## Confidence Calibration

`ConfidenceCalibration.adjust(currentConfidence, outcome, evidenceCount)`:

- Increases confidence on success
- Decreases confidence on failure
- Modestly adjusts on partial success, scaled by error ratio
- Dampens adjustments when evidence is below the policy's threshold
- Respects per-policy `minConfidence` and `maxConfidence`

## Learning Policies

| Policy | Learning Rate | Adjustment Factor | Evidence Threshold | Min Confidence | Max Confidence | Recommendation Threshold |
|---|---|---|---|---|---|---|
| Conservative | 0.05 | 0.3 | 10 | 0.1 | 0.9 | 0.7 |
| Balanced | 0.10 | 0.5 | 5 | 0.05 | 0.95 | 0.6 |
| Aggressive | 0.20 | 0.8 | 3 | 0.0 | 1.0 | 0.5 |
| Experimental | 0.30 | 1.0 | 1 | 0.0 | 1.0 | 0.4 |

## Safety

- Learning is additive. It never rewrites the `AuditLedger`, deletes audit
  records, modifies historical recommendations, or hides failed predictions.
- `DecisionOutcomeStore` persists atomically (write temp file + rename).
- All new modules implement `start()`, `stop()`, `flush()`, `destroy()`, and
  `healthCheck()`.
- `ExecutiveOperatingSystem` still consumes learning only through the injected
  `LearningMetrics` interface.

## Validation

| Check | Result |
|---|---|
| `npm run typecheck` | pass, 0 errors |
| `npm run typecheck:hydi-v3` | pass, 0 errors |
| `npm run lint:hydi-v3` | pass, 0 errors (14 pre-existing `no-console` warnings) |
| `DecisionOutcomeStore.test.js` | pass, 9/9 |
| `RecommendationTracker.test.js` | pass, 5/5 |
| `ConfidenceCalibration.test.js` | pass, 8/8 |
| `BusinessOutcomeEngine.test.js` | pass, 7/7 |
| `LearningMetrics.test.js` | pass, 5/5 |
| `npm test` (full suite) | pass, 192/192 suites, 1953/1953 tests |
| `npm run benchmark:performance` | pass |

## Self-Audit Findings

- Fixed two new `no-unused-vars` warnings in `DecisionOutcomeStore.test.js`.
- Fixed `RecommendationTracker` to always generate a new recommendation id while preserving the caller's id as `sourceId`.
- Fixed `DecisionOutcomeStore` to honor input `createdAt` for accurate recency queries.
- Tuned `ConfidenceCalibration` evidence scale so the first outcome still produces a non-zero adjustment.
- Updated `BriefingRenderer.test.js` to expect the new `learning-summary` section.
- Removed duplicated `execution.completedAt` fallback in `DecisionOutcomeStore.recordExecution`.
- Ensured `RecommendationTracker.getRecentRecommendations()` returns recommendations sorted newest-first.
- Confirmed `AuditLedger` is never imported or modified by any Phase 19 module.
- All new modules implement `start/stop/flush/destroy/healthCheck` with no leaked timers or listeners.

## Known Limitations

- `BusinessOutcomeEngine.observeAction` records `completed` outcomes as meeting expectation; richer action results can be passed through `observed.value` for exact scoring.
- `TrustEngine.generateProvenance` computes aggregate metrics once per recommendation. For very large recommendation stores, a cached metrics snapshot would be a future optimization.
- `ExecutiveOperatingSystem` tracks recommendations only when `recommendationTracker` is wired; missing `learningMetrics` degrades gracefully to the baseline message.

## Future Recommendations

- Add a persistent `LearningSnapshot` cache to avoid recomputing metrics for every recommendation provenance.
- Surface per-objective confidence trends in the Executive Cockpit beyond the top/lowest area summary.
- Wire `LearningMetrics` outcomes back into `StrategicObjectives` weighting once enough historical data is available.

## Self-Audit

- No duplicate learning paths. Recommendation flow goes through
  `RecommendationTracker` and `BusinessOutcomeEngine` only.
- Recommendation IDs are generated once per tracked recommendation and preserved.
- Confidence changes are deterministic given the same policy, evidence, and
  outcome.
- Audit ledger remains untouched by learning code.
- `ExecutiveOperatingSystem` consumes learning through `learningMetrics` and
  `recommendationTracker` config only.
- Failed recommendations remain visible in the store, metrics, and dashboard.
- `LearningMetrics` reads from persisted `DecisionOutcomeStore`, so it survives
  restart.
- No leaked timers, listeners, or processes in the new modules.
