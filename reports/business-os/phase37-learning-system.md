# Phase 37 — Learning System

Generated: 2026-07-28

## Adaptive Memory Quality

`src/hydi-v3/SemanticMemoryIndex.js` now computes a `MemoryQualityScore` based on:

- Confidence.
- Verification status.
- Age.
- Retrieval frequency.
- Successful retrieval ratio.
- Contradictions.

`runQualityPass()` automatically:

- Promotes high-quality memories to `EXECUTIVE` tier.
- Archives weak memories to `LONG_TERM` tier and flags them for operator
  review.
- Leaves verified `EXECUTIVE` memories protected and never deletes them
  automatically.

Metrics include doc count, duplicate rate, stale count, contradiction count,
average quality, review recommendations, archived count, promoted count, and
protected count.

## Model Learning

`AdaptiveModelOptimizer` continuously refines model selection using:

- Latency trends (average and p95).
- Success/failure rates.
- Confidence calibration error.
- CPU and memory cost.
- Operator preference.

The optimizer computes a single score per model and explains it in plain text.

## Outcome Learning

`ExecutionOutcomeTracker` records every decision outcome and provides rolling
statistics and per-model/per-agent summaries. It never overwrites historical
data.

## Feedback Loop

`OperatorFeedbackEngine` converts operator actions (positive, negative, ignored,
override, cancelled) into per-task/per-model weights. These weights adjust
future recommendation scores without bypassing the `ExecutionPolicy` gate.

## Validation Results

- `phase37-validation.js`: PASS
- `phase37-self-evaluation.js`: PASS
- `phase37-performance-regression.js`: PASS
- `npm run typecheck:hydi-v3`: PASS
- `npx tsc --noEmit -p src/hydi-v3/jsconfig.json`: PASS
- `npx eslint src/hydi-v3 --ext .js`: PASS
