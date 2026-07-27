# Phase 19A — Learning Feedback Loop Audit

Date: 2026-07-25
Branch: clean-main
Audits: Phase 19 (`eb3e1ce`)
Note: renumbered from 20 — Phase 20 is the Outcome Intelligence & Business Evidence Framework (`02e6f1a`).

## Why This Audit

Phase 19 lets observed outcomes change future recommendations. That is the same shape `CLAUDE.md` records as V1's failure: enforcement built before ground truth was anchored, producing false positives and feedback loops. A learning loop is the one component where being wrong compounds — a bad inference becomes evidence for the next bad inference.

The audit asked four questions: can the loop amplify its own output, can low sample counts swing scoring, are adjustments bounded and reversible, and is the loop actually connected.

## Results

**The calibration mathematics are sound.** `ConfidenceCalibration.adjust()` scales each delta by `(1 - confidence)` for successes and `confidence` for failures, so it asymptotes rather than diverging; evidence scaling saturates at the policy threshold; every policy clamps to its own min/max. Driven 200 iterations in each direction, every policy stayed inside its bounds and step size strictly decreased. A single outcome moves confidence by ~0.005 under the balanced policy. None of this needed changing.

**Six defects, all in the plumbing around that mathematics.**

### 1. The learning loop was inert

`ExecutionGateway._observeOutcome()` guards on `entry.recommendationId`, but `execute()` never copied `recommendationId` from the action onto the entry. The field was always `undefined`, so `observeAction()` could never fire from the gateway. Phase 19 wired `outcomeEngine` into the gateway, added the observation hook, and passed its tests — while the path was unreachable. Only the workflow route closed the loop at all.

This is the failure mode where everything reports healthy: tests green, `healthCheck()` ok, no errors.

### 2. Completion was treated as success — the ground-truth inversion

`observeAction()` on `status === 'completed'` recorded an outcome of type `successful` with `value: rec.expectedValue`. The action running was taken as proof it delivered the value the recommendation predicted. Nothing was ever measured; the system confirmed its own forecast and raised confidence on the strength of it.

This is precisely the V1 pattern — learning running ahead of observed truth. Fixing (1) without fixing this would have activated a loop that manufactures its own evidence.

Completion now advances execution status only. The recommendation stays in `getAwaitingOutcomes()` until a real measured value arrives. Execution *failure* is still recorded as an outcome, because an action that could not run genuinely cannot deliver value.

### 3. Simulated executions taught the system

`_observeOutcome()` was called inside `_runEntry()` regardless of the `simulate` flag. Combined with (2), a `--dry-run` session — the mode whose entire purpose is to change nothing — would have raised confidence on every simulated action. Dormant only because of (1).

### 4. Outcomes were not terminal

The same recommendation could be observed unlimited times, each call appending an outcome row and ratcheting confidence. Fifteen calls produced a confidence climb from 0.505 to 0.627 on a single real event. A retried execution or a duplicated observation would fabricate evidence.

Outcomes are now terminal by default; `{ supersede: true }` deliberately replaces one. The guard is enforced in both the store *and* the engine — the store refuses the duplicate row, but calibration happens in the engine, so without the second guard confidence still ratcheted while recording no new evidence. The first fix alone left the bug half-present, which the regression test caught.

### 5. Every outcome was written twice

`BusinessOutcomeEngine.recordOutcome()` called `store.recordOutcome()` and then `recommendationTracker.recordOutcome()`, which delegates to the same store instance. Fifteen calls produced thirty rows. This inflated `outcomeCount`, `getLearningSummary()`, `healthCheck().outcomes`, and every metric derived from `store.outcomes`.

### 6. A corrupt store was discarded without a copy

`DecisionOutcomeStore._load()` reset to empty on a parse failure and did not archive the corrupt file, unlike every other hydi-v3 store. The next debounced persist would then overwrite the entire learning history with an empty snapshot, leaving nothing to recover from. The outcome log was also uncapped, unlike every comparable store.

## Files Added

- `tests/unit/hydi-v3/LearningLoopIntegrity.test.js` — 17 tests.

## Files Modified

- `src/hydi-v3/ExecutionGateway.js` — carries `recommendationId` onto the entry; never observes outcomes for simulated runs.
- `src/hydi-v3/BusinessOutcomeEngine.js` — completion is execution progress, not a measured outcome; duplicate observations are refused before calibration; provenance carried through; no double-write via the tracker.
- `src/hydi-v3/DecisionOutcomeStore.js` — outcomes terminal by default with explicit supersede; `measured` and `provenance` fields; corrupt-store archiving; outcome log capped at 5000.
- `tests/unit/hydi-v3/BusinessOutcomeEngine.test.js` — the completion test asserted the old behaviour and now encodes the new contract.
- `scripts/minitest.js` — added `expect.arrayContaining` / `objectContaining` / `any`.

## Design Note: Measured vs Inferred

Outcomes now carry `measured` and `provenance`. The distinction matters more than the fix to any single call site: the system can hold "this action completed" and "this action achieved its predicted value" as separate facts. Only the second is evidence about the world, and only the second should move confidence. Every future integration that wants to close the loop has to say which kind of claim it is making.

## Self-Audit Results

- Gateway link asserted present, so the loop cannot silently go inert again.
- Completion asserted to leave `observedOutcome` null and confidence unchanged.
- Recommendation asserted to remain in `getAwaitingOutcomes()` after execution.
- Dry-run and gateway-wide simulate both asserted to record nothing.
- Duplicate observation asserted to change neither outcome count nor confidence.
- Supersede asserted to work when explicitly requested.
- Bounds asserted for every policy in both directions over 200 iterations.
- Single-outcome delta asserted below 0.1.
- Confidence history asserted to record every adjustment, so learning is inspectable.
- Corrupt store asserted to be archived; outcome log asserted capped.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.typecheck.json` | pass, 0 errors |
| `LearningLoopIntegrity.test.js` | 17/17 pass |
| Learning suites | 52/52 pass — DecisionOutcomeStore, BusinessOutcomeEngine, RecommendationTracker, ConfidenceCalibration, LearningMetrics, LearningLoopIntegrity |
| Gateway / mode / coverage / workflow suites | 58/58 pass |
| Session / sensing / briefing suites | 76/76 pass — OperatorSession, GitSensor, ExecutiveOperatingSystem, ExecutiveCockpit |
| Live: 40 measured cycles | 40 recommendations, 40 outcome rows (not 80), confidence 0.5010–0.5250, no divergence |
| Live: execution without measurement | stays `awaiting`, confidence unchanged at 0.5 |
| Live: 10 simulated executions in a dry-run session | confidence unchanged, 0 outcomes recorded |

**Not run in this environment:** full `npm test` (192 suites) and `npm run lint:hydi-v3` — Jest's crawler and ESLint's plugin resolution stall on the mounted volume. `scripts/minitest.js` executed the real test files instead. Run both on the host before merge.

## Next Recommended Milestone

**Close the loop honestly: an outcome capture surface.** The loop is now correct but under-fed — nothing supplies measured values, so recommendations accumulate in `getAwaitingOutcomes()`. The cockpit should surface that queue and let the owner record what actually happened. That is the honest version of what defect 2 was faking, and it is the smallest change that makes the learning loop real.

The Stripe/revenue sensor remains the strongest candidate after that, since settled payments are a genuinely measured value that could feed outcomes automatically rather than by hand.
