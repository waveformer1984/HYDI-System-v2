# Phase 20 – Outcome Intelligence & Business Evidence Framework

## Overview

Implemented the Business Evidence Framework so HYDI can distinguish between work
completed and business value created. Every recommendation now accumulates
measured evidence before any outcome or confidence change is applied.

## Architecture

```
Business Signals
        ↓
Evidence Collectors
        ↓
Outcome Intelligence (BusinessEvidenceEngine)
        ↓
Recommendation Tracker
        ↓
Confidence Calibration
        ↓
Trust Engine
```

No sensor modifies confidence directly. The Execution Gateway does not determine
success. The ExecutiveOperatingSystem does not evaluate outcomes. Every outcome
flows through one pipeline: `EvidenceCollector` → `OutcomeEvaluator` →
`BusinessEvidenceEngine` → `BusinessOutcomeEngine` → `DecisionOutcomeStore`.

## Modules

| Module | Path | Responsibility |
|---|---|---|
| `BusinessKPIRegistry` | `src/hydi-v3/BusinessKPIRegistry.js` | Configurable business KPI definitions and evaluation |
| `EvidenceProviders` | `src/hydi-v3/EvidenceProviders.js` | Pluggable providers that turn bus events into evidence items |
| `EvidenceCollector` | `src/hydi-v3/EvidenceCollector.js` | Collects evidence from the event bus and manual submissions |
| `OutcomeCorrelation` | `src/hydi-v3/OutcomeCorrelation.js` | Compares expected vs observed value and impacts |
| `OutcomeEvaluator` | `src/hydi-v3/OutcomeEvaluator.js` | Classifies evidence into one of the six outcome states |
| `BusinessEvidenceEngine` | `src/hydi-v3/BusinessEvidenceEngine.js` | Orchestrates evidence collection, outcome evaluation, and confidence calibration |

## Evidence Pipeline

1. `EvidenceCollector` subscribes to `BusinessEventBus` and dispatches events
   through `EvidenceProviders`.
2. Each provider returns an evidence item with `confidence`, `provenance`,
   `timestamp`, `source`, `relevance`, and `weight`.
3. Manual confirmations are added directly through `addEvidence` or
   `submitManualReview`.
4. `BusinessEvidenceEngine.evaluateRecommendation` collects relevant evidence,
   computes a KPI snapshot from `BusinessKPIRegistry`, and calls
   `OutcomeEvaluator.evaluate`.
5. `OutcomeEvaluator` returns one of:
   - `Confirmed Success`
   - `Partial Success`
   - `Neutral`
   - `Negative`
   - `Inconclusive`
   - `Insufficient Evidence`
6. If the classification maps to a measurable outcome, `BusinessEvidenceEngine`
   calls `BusinessOutcomeEngine.recordOutcome` with `measured: true` and a
   provenance string.
7. `BusinessOutcomeEngine` computes impacts, calibrates confidence, and stores the
   result.

## Outcome Mappings

| Phase 20 Classification | BusinessOutcomeEngine Type | Confidence Effect |
|---|---|---|
| Confirmed Success | `successful` | Increase |
| Partial Success | `partially successful` | Moderate increase |
| Neutral | `neutral` | No change |
| Negative | `failed` | Decrease |
| Inconclusive | none | No change |
| Insufficient Evidence | none | No change |

## Integration

- `OperatorSession` constructs `BusinessEvidenceEngine` after
  `BusinessOutcomeEngine` and wires the `BusinessEventBus`.
- `ExecutiveOperatingSystem` now includes a `businessEvidence` summary in the
  morning briefing.
- `BriefingRenderer` renders a new `Business Evidence` section.
- `ExecutiveCockpit` adds `evidence`, `outcomes`, `kpis`, and `review` commands.
- `index.js` exports all new modules.

## Manual Review

```bash
npm run cockpit
# "review <recommendation-id>"          -> shows the question
# "review <recommendation-id> yes"    -> Confirmed Success
# "review <recommendation-id> no"     -> Negative
# "review <recommendation-id> partial" -> Partial Success
# "review <recommendation-id> unknown" -> Inconclusive
```

## Safety

- `ExecutionGateway` no longer determines success.
- Sensors do not modify confidence.
- Evidence is never fabricated; missing evidence is reported as
  `Insufficient Evidence`.
- The `AuditLedger` is not touched by the evidence framework.
- `ConfidenceCalibration` supports `neutral` with zero delta.

## Defects Found and Resolved During Verification

1. **Manual confirmation was treated as a measured value.** Owner "yes" responses
   produced `actual: 0` because no numeric value existed, which booked a revenue
   impact equal to the entire negative expectation for a confirmed success.
   `OutcomeEvaluator` now returns `hasMeasuredValue: false` for manual
   confirmations, and `BusinessOutcomeEngine` skips calibration and records
   `actual: null` when `measured: false`.
2. **`EvidenceCollector` used a non-existent `unsubscribeAll` method.** This
   would have leaked bus listeners across sensor restarts. It now calls
   `BusinessEventBus.unsubscribe('*', handler)`.
3. **`OutcomeCorrelation` had no `hasMeasuredValue` guard.** Without it the
   evaluator would have read "no numeric evidence" as "measured zero" and
   classified every non-measured recommendation as a failure. The correlation
   now reports whether any evidence item carried a numeric `value`.
4. **`BriefingRenderer` section list was out of sync.** The new
   `business-evidence` section was added to `toSections` and the corresponding
   expectation was updated in `BriefingRenderer.test.js`.

## Validation

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run typecheck:hydi-v3` | pass |
| `npm run lint:hydi-v3` | pass (0 errors, 14 pre-existing warnings) |
| `BusinessKPIRegistry.test.js` | pass (5/5) |
| `EvidenceCollector.test.js` | pass (5/5) |
| `OutcomeCorrelation.test.js` | pass (4/4) |
| `OutcomeEvaluator.test.js` | pass (7/7) |
| `BusinessEvidenceEngine.test.js` | pass (7/7) |
| `BusinessOutcomeEngine.test.js` | pass (8/8) |
| `BriefingRenderer.test.js` | pass (16/16) |
| `TrustEngine.test.js` | pass (5/5) |
| `npm test` (full suite) | pass (199 suites, 2012 tests) |
| `npm run benchmark:performance` | pass |
