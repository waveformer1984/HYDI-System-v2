# Phase 21 — Evidence Capture Audit

Date: 2026-07-25
Branch: clean-main
Audits: the uncommitted evidence-capture layer (`BusinessEvidenceEngine`, `EvidenceCollector`, `EvidenceProviders`, `BusinessKPIRegistry`, `OutcomeEvaluator`, `OutcomeCorrelation`)
Builds on: Phase 20 Learning Feedback Loop Audit

## Why This Audit

Phase 20 established that only *measured* values may move confidence, and left recommendations sitting in `getAwaitingOutcomes()` with nothing to supply a measurement. The evidence layer is what closes that gap — which makes it the component that now decides what counts as a measurement. Getting that boundary wrong reintroduces the ground-truth inversion through a new door.

## Results

**The gating logic is correct.** No evidence produces no outcome; evidence below the quality threshold produces no outcome; an inconclusive or skipped manual review produces no outcome. `outcomeType: null` reliably means "nothing recorded", and re-evaluation is blocked by the Phase 20 terminal-outcome guard. None of that needed changing.

**The value path conflated classifying an outcome with quantifying it.** Four defects, all downstream of one root cause: evidence carrying no number was treated as a *measured zero*.

### 1. A confirmed success booked a loss equal to the whole expectation

`submitManualReview(id, 'Yes')` on a recommendation with `expectedValue: 10000` recorded:

```
outcomeType: 'successful'   measured: true
actual: 0                   impacts.revenue: -10000
```

The same record simultaneously said the recommendation succeeded and destroyed £10,000 of value. Confidence rose while the financial impact said the opposite. Any revenue analytics built on `impacts.revenue` would have been poisoned by every qualitative confirmation.

`measured: true` was hard-coded whenever an `outcomeType` existed — the same "assert measurement without checking" pattern as Phase 20's defect 2.

### 2. Confirming a success *lowered* the observed value

`sumEvidenceValue()` computed a weighted mean across all evidence, substituting `0` for items with no `data.value`. Real evidence of 9500 plus an owner confirmation produced **4871.79**. The more the owner confirmed, the worse the measurement looked.

### 3. Evidence variance was not scale-free

`evidenceVariance` was a raw mean squared deviation in currency units — 22,577,334 in the probe above — compared against a threshold of `0.8`. Any two numeric measurements that differed at all would classify as "contradictory or highly variable", so multi-sample evidence was heading for permanent `Inconclusive`. It is now the coefficient of variation, bounded 0–1, which is what the threshold was written for.

### 4. Strategic impact mixed money with a 0–1 score

`clamp(observedValue - expectedStrategic, -1, 1)` subtracted a 0–1 target from a monetary value, saturating to `+1` for any realistic amount. The field was always `1` and carried no information. It now derives from forecast accuracy, so it varies meaningfully and stays in range.

## Files Modified

- `src/hydi-v3/OutcomeCorrelation.js` — `sumEvidenceValue()` ignores non-numeric evidence and returns `{value, numericCount, values}`; `correlate()` exposes `hasMeasuredValue` and returns `observedValue: null` when nothing numeric was seen; variance is now the coefficient of variation; strategic impact derives from accuracy.
- `src/hydi-v3/OutcomeEvaluator.js` — returns `Inconclusive` when quality passes but no numeric value exists, instead of scoring a ratio off a missing measurement and classifying it a failure; propagates `hasMeasuredValue`.
- `src/hydi-v3/BusinessEvidenceEngine.js` — `measured` now reflects whether a number was observed; passes `value: null` for qualitative outcomes.
- `src/hydi-v3/BusinessOutcomeEngine.js` — `computeImpacts()` returns `revenue: null` when there is no observed value, rather than booking a loss equal to the expectation.

## Files Added

- `tests/unit/hydi-v3/EvidenceMeasurementIntegrity.test.js` — 13 tests.

## Design Note: Classification and Quantification Are Different Claims

An owner saying "yes, that worked" is a real and useful judgement. It is not a measurement. The system now holds those separately: a qualitative confirmation sets `outcomeType` and moves confidence, but leaves `actual` and `impacts.revenue` null rather than inventing a number. A numeric measurement does both.

This extends the `measured` / `provenance` distinction introduced in Phase 20 to the layer that produces the values, which is where it actually has to hold. Every future evidence provider inherits the rule: if you cannot supply a number, do not claim one.

## Self-Audit Results

- Qualitative confirmation asserted to leave `actual` and `impacts.revenue` null with `measured: false`.
- A confirmed success asserted never to book a negative revenue impact.
- Qualitative evidence asserted not to dilute a real measurement (9500 stays 9500).
- Numeric evidence asserted to record `measured: true` with a correct impact.
- Non-numeric evidence asserted to be inconclusive, not a failure.
- Variance asserted bounded 0–1; consistent large values asserted not contradictory; genuinely contradictory evidence asserted still flagged.
- Strategic impact asserted in range across 1 → 1,000,000 and asserted to order by forecast accuracy.
- Evidence asserted to drain the awaiting-outcome queue — the Phase 20 gap is closed.
- Re-evaluation asserted not to ratchet confidence, so the Phase 20 terminal-outcome guard holds through this new path.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.typecheck.json` | pass, 0 errors |
| `EvidenceMeasurementIntegrity.test.js` | 13/13 pass |
| Evidence + learning suites | 53/53 pass — OutcomeCorrelation, OutcomeEvaluator, BusinessEvidenceEngine, EvidenceCollector, BusinessKPIRegistry, LearningLoopIntegrity, BusinessOutcomeEngine |
| Trust / briefing / gateway / coverage suites | 76/76 pass |
| Session / sensing / learning-metric suites | 94/94 pass |
| Live: owner confirms "Yes" | `actual: null`, `revenue: null`, confidence 0.5 → 0.505 |
| Live: measured 9500 vs expected 10000 | `revenue: -500`, `measured: true` |
| Live: measurement + confirmation together | observed stays 9500, variance 0 |
| Live: no evidence | no outcome recorded |

**Not run in this environment:** full `npm test` and `npm run lint:hydi-v3` — Jest's crawler and ESLint's plugin resolution stall on the mounted volume. `scripts/minitest.js` executed the real test files instead. Run both on the host before merge.

## A Note on the `EvidenceCollector.stop()` Fix

The `unsubscribeAll` → `unsubscribe('*', …)` change in the working tree is correct and load-bearing: `BusinessEventBus` has no `unsubscribeAll` method, so `stop()` would have thrown a `TypeError` on every shutdown once the collector was started. Worth keeping.

## Commit Contents

This tree contains three phases' work, committed together as agreed:

- **Phase 20** — learning-loop audit fixes (dead gateway link, completion-as-success, simulation teaching, non-terminal outcomes, double-writes, unarchived corrupt store).
- **Phase 21 (other agent)** — the evidence-capture layer itself.
- **Phase 21 audit** — the four measurement defects above.

## Next Recommended Milestone

**A real evidence provider.** Everything is now in place to accept measurements, and nothing automatic produces them — `EvidenceProviders` registers defaults, but a Stripe sensor turning settled payments into numeric evidence would be the first provider supplying genuinely measured business value without a human in the loop. It is also still the untested boundary direction: pull-based, external, and the first thing needing network, so it must interact correctly with `--offline`.
