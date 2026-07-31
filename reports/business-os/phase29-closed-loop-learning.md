# Phase 29: Closed-Loop Learning & Executive Intelligence

## Summary

This phase completes the HYDI V3 executive feedback loop. Every recommendation now has a persisted lifecycle, conversational outcome recording, executive learning dashboards, and aging-based abandonment. The implementation extends the existing V3 architecture only — no parallel systems, no duplicate intelligence layers, and no fabricated outputs.

---

## Architecture

The closed-loop pipeline remains the single V3 path described in earlier phases:

```text
ConversationEngine
  ↓
ExecutiveCockpit
  ↓
ApprovalCenter
  ↓
ExecutionGateway
  ↓
CapabilityAdapter (GenericTaskAdapter added this phase)
  ↓
AuditLedger
  ↓
BusinessEvidenceEngine
  ↓
OutcomeCorrelation
  ↓
BusinessOutcomeEngine / RecommendationTracker
  ↓
DecisionOutcomeStore (persisted)
  ↓
TrustEngine + LearningMetrics
  ↓
ExecutiveOperatingSystem.morningBriefing
  ↓
future recommendations
```

No new authority layer was introduced. The `ConversationEngine` still never executes actions; all mutations route through `ApprovalCenter` and `ExecutionGateway`.

---

## Implementation

### 1. Conversational action creation (Priority 1, completed earlier)

- Added `GenericTaskAdapter` in `src/hydi-v3/CapabilityAdapters.js` for verbs: `do`, `start`, `create-task`, `remind`, `investigate`, `analyze`, `print`, `generate`, `build`, `review`, `monitor`.
- Wired it into `ExecutionGateway` default adapters.
- Extended `ConversationEngine` `_createAction` to create a tracked `RecommendationTracker` recommendation for every action so the execution carries a `recommendationId`.

### 2. Recommendation lifecycle tracking

- `DecisionOutcomeStore` now sets explicit `status` values:
  - `proposed`, `approved`, `executing`, `executed`, `confirmed`, `partially-confirmed`, `failed`, `abandoned`, `rejected`, `cancelled`, `superseded`.
- `DecisionOutcomeStore.recordExecution` updates `executionStatus` and `status` and marks a completed execution as implicitly `ownerDecision: 'approved'`.
- `DecisionOutcomeStore.recordOutcome` normalizes outcome types and sets terminal `status`.
- Added `DecisionOutcomeStore.abandon(id, reason)` for explicit abandonment.

### 3. Conversational outcome recording

- Extended `ExecutiveCockpit.parseCommand` and `handleCommand` with:
  - `measure <id|keyword> success|failed|partial|abandoned [+/-value]`
  - `measure revenue +9500`
  - `customer satisfied`, `project completed`, `build failed`, etc.
  - `abandon <id>`
  - `awaiting measurements`
- Added `ExecutiveCockpit._resolveTarget` to map `exec_...` ids to their linked recommendation, resolve keywords (`revenue`, `customer`, `project`, `build`), and fall back to the single awaiting outcome.
- Added `ExecutiveCockpit.measureOutcome` which routes:
  - numeric values through `BusinessEvidenceEngine.addEvidence` + `evaluateRecommendation`
  - qualitative labels through `submitManualReview`
  - `abandoned` through `RecommendationTracker.recordOutcome`

### 4. Learning dashboards

- Existing `ExecutiveCockpit` commands `learning`, `outcomes`, `measured`, `recommendations`, `evidence` already surface real `LearningMetrics` and `BusinessEvidenceEngine` data.
- `ExecutiveOperatingSystem.morningBriefing` already includes `learningSummary`, `awaitingMeasurements`, `recentlyCalibrated`, `topImproving`, and `losingConfidence`.
- `BriefingRenderer` now renders a `stale-warnings` section when the briefing contains stale or auto-abandoned recommendations.

### 5. Preventing permanent "awaiting outcome"

- Added `BusinessEvidenceEngine.abandonStale(reason)`.
- `ExecutiveOperatingSystem.morningBriefing` calls `abandonStale` and carries both `staleAbandoned` and `staleRemaining` warnings into the rendered briefing.
- `getAwaitingOutcomes` excludes any recommendation with an `observedOutcome`.

### 6. Restart persistence

- `RecommendationTracker`, `DecisionOutcomeStore`, `ExecutionGateway`, and `AuditLedger` persist to `dataPath`.
- Verified by integration test: a stopped session is restarted and restored recommendations, outcomes, and learning metrics are intact.

---

## Validation

### Commands verified through real system execution

```text
good morning
what should I focus on
do follow up with enterprise lead
show approvals
approve <exec_id>
history
measure <exec_id> success
measure revenue +12500
learning
awaiting measurements
abandon <id>
```

### Tests run

```powershell
npx jest tests/unit/hydi-v3/ConversationEngine.test.js
npx jest tests/unit/hydi-v3/ExecutiveCockpit.test.js
npx jest tests/unit/hydi-v3/ExecutionGateway.test.js
npx jest tests/unit/hydi-v3/DecisionOutcomeStore.test.js
npx jest tests/unit/hydi-v3/BusinessEvidenceEngine.test.js
npx jest tests/unit/hydi-v3/ExecutiveOperatingSystem.test.js
npx jest tests/unit/hydi-v3/BriefingRenderer.test.js
npx jest tests/unit/hydi-v3/LearningLoopIntegrity.test.js
npx jest tests/unit/hydi-v3/Phase29ClosedLoop.test.js
```

All passed. The new `Phase29ClosedLoop.test.js` covers:

- recommendation → approval → execution → audit → measurement
- quantitative revenue measurement and confidence movement
- partial success
- duplicate measurement suppression
- rejected recommendation lifecycle
- abandoned recommendations and awaiting-outcome cleanup
- stale auto-abandonment
- restart persistence
- multi-source evidence aggregation

### Operational demonstration

`node scripts/phase29-closed-loop-demo.js` executed successfully against the real stack. It showed a full operator session from `good morning` through `do`, `approve`, `history`, `measure`, `learning`, `awaiting measurements`, and restart recovery.

### Lint

```powershell
npx eslint src/hydi-v3/ConversationEngine.js src/hydi-v3/ExecutiveCockpit.js src/hydi-v3/ExecutionGateway.js src/hydi-v3/CapabilityAdapters.js src/hydi-v3/DecisionOutcomeStore.js src/hydi-v3/BusinessEvidenceEngine.js src/hydi-v3/ExecutiveOperatingSystem.js src/hydi-v3/BriefingRenderer.js src/hydi-v3/OperatorSession.js
```

Exit code 0.

---

## Known Limitations

1. **Confidence for qualitative outcomes**: `submitManualReview` with `Yes`/`Partially`/`No` records an outcome but does not attach a measured numeric value, so it moves confidence through classification only. This is intentional — qualitative confirmation is not a business value measurement.
2. **Revenue keyword target**: `measure revenue +X` resolves to a single `revenue measurement` recommendation. Concurrent revenue measurements overwrite the same target. This is sufficient for demonstration; a production system would likely want per-campaign or per-customer targets.
3. **Auto-abandonment window**: `staleMs` is 14 days by default. This is conservative; operators should tune for their domain.
4. **GenericTaskAdapter side effects**: it writes task files to `data/actions/`. It does not perform external operations (print, email, etc.), keeping the loop safe and deterministic.

---

## Remaining Work

- Connect real external sensor data so `morningBriefing` recommendations are grounded in live signals rather than the empty baseline.
- Add per-adapter outcome metadata (e.g., `printer` success/failure from `PrinterSensor`) so `measure printer successful` can be sourced from real observations.
- Extend the web UI (`scripts/hydi-dashboard.js` / `api/` routes) to expose `awaiting measurements`, `abandon`, and `measure` inputs.
- Tune `ConfidenceCalibration` policies per strategic objective once a real baseline is built.

---

## Production Readiness

- All lifecycle state is persisted and survives restart.
- No recommendation can remain permanently in `awaiting-outcome` (aging + abandonment).
- Learning metrics (`LearningMetrics.computeMetrics`) are derived from real `DecisionOutcomeStore` records.
- Every action mutates through `ApprovalCenter` and is recorded in `AuditLedger`.
- The implementation reuses existing V3 components only and introduces no duplicate intelligence layer.

**Status**: Phase 29 closed-loop learning is operationally ready for local-first execution and can be exercised end-to-end through `OperatorSession.ask` or the `scripts/phase29-closed-loop-demo.js` script.
