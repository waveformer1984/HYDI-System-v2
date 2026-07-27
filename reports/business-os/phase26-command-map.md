# Phase 26 — Command Map

## CLI commands (`scripts/hydi-cli.js`)

### `hydi status`

- **Input:** optional `--data-path <dir>`
- **Output:** `HYDI OPERATING STATE` — runtime, uptime, events processed, recommendations, pending approvals, awaiting measurements, audit entries, learning updates, last verified action, warnings.
- **Data source:** `HYDIContinuousRuntime.getStatus()`, `session.certify()`.
- **Audit impact:** none (read-only).
- **Failure behavior:** exits 1 if runtime is not `READY`.

### `hydi readiness`

- **Input:** optional `--data-path <dir>`
- **Output:** `HYDI SYSTEM READINESS` — boot status, sensors, signals, audit, learning, last recommendation, last decision, per-component checks.
- **Data source:** `HYDIOperationalBoot.boot()`, `buildSummary()`.
- **Audit impact:** none (read-only).
- **Failure behavior:** exits 1 if system is not `READY`.

### `hydi health` *(new in Phase 26)*

- **Input:** optional `--data-path <dir>`
- **Output:** `HYDI HEALTH` — per-component health checks, warnings, failures.
- **Data source:** `HYDIOperationalBoot.boot()`, `session.certify()`.
- **Audit impact:** none (read-only).
- **Failure behavior:** exits 1 if boot status is not `ready`.

### `hydi outcome <id>` *(new in Phase 26)*

- **Input:** `--result <successful|unsuccessful|unknown>` optional `--value <n>`, `--source <text>`, `--notes <text>`, `--data-path <dir>`.
- **Output:** Outcome recorded, measured flag, confidence and delta, lesson.
- **Data source:** `BusinessOutcomeEngine.recordOutcome()`.
- **Audit impact:** writes the recommendation's observed outcome and confidence history; an `outcome-recorded` event is audited through the recommendation store flush.
- **Failure behavior:** exits 1 if id missing, recommendation not found, or result invalid.

### `hydi memory-review` *(new in Phase 26)*

- **Input:** optional `--data-path <dir>`
- **Output:** `HYDI MEMORY REVIEW` — recent decisions, actions, measured outcomes, confidence changes, lessons.
- **Data source:** `ExecutiveOperatingSystem.decisions`, `ExecutionGateway` history, `RecommendationTracker`, `LearningMetrics`.
- **Audit impact:** none (read-only).
- **Failure behavior:** exits 1 if runtime cannot start.

## Conversational cockpit commands

| Command | Output | Data source | Audit impact | Failure behavior |
|---------|--------|-------------|--------------|------------------|
| `good morning` | Full executive briefing | `ExecutiveOperatingSystem.morningBriefing()` | Records `briefing-generated` | Falls back to summary if EOS unavailable |
| `status` | Short status summary | `ExecutiveCockpit.getDashboardData()` | Persists interaction in cockpit store | Returns unavailable text |
| `what changed` | Activity since last briefing | `ExecutiveOperatingSystem.recentActivitySummary()` | None | Returns not connected message |
| `what deserves my attention` | Risks + pending approvals | `ExecutiveOS` + `ApprovalCenter.list()` | None | Empty list if nothing pending |
| `show approvals` | Pending approval list | `ApprovalCenter.list()` | None | No approvals message |
| `explain approval <id>` | Why, impact, risk, undo, evidence, audit | `ApprovalCenter.explain()` + `BusinessEvidenceEngine` | None | Not found message |
| `approve <id>` / `reject <id>` | Approval result | `ExecutionGateway.approve/reject()` | `action-approved`/`action-rejected` + `action-executed` | Not found if stale/missing |
| `simulate <id>` | Dry-run preview | `ExecutionGateway.simulatePending()` | None | Not found |
| `focus <priority>` | Priority set | `StrategicObjectives` | Persists in session memory | Unknown priority rejected |
| `learning` | Learning dashboard | `LearningMetrics` + `BusinessEvidenceEngine` | None | Not connected message |
| `outcome queue` | Awaiting measurement | `BusinessEvidenceEngine.getRecommendationsAwaitingReview()` | None | Empty list |
| `review <id> <answer>` | Qualitative outcome | `BusinessEvidenceEngine.submitManualReview()` | Updates recommendation evidence | Requires valid answer |
| `health` | Business health dashboard | `ExecutiveCockpit.startupCheck()` / `BusinessEvidenceEngine` | None | Not connected message |
| `memory-review` *(alias)* | Memory review | Same as `hydi memory-review` | None | None |

## Identified issues

### Duplicate commands

- `status` and `readiness` overlap: both report health. `status` is a runtime snapshot; `readiness` is a boot summary. Keep both but document the distinction.
- `learning` and `measured` overlap: both show measured outcomes. `learning` is summary; `measured` is detailed dashboard.

### Confusing terminology

- `review <id>` is actually a manual outcome classification, not an approval review. Rename risk: could be mistaken for `approve`. Alias `measure <id>` not yet implemented.
- `outcome queue` vs `show approvals`: one is pending measurement, one is pending action. Names are clear but could be cross-referenced.

### Missing operator actions

- No single `memory-review` conversational command existed before Phase 26; added as `hydi memory-review` CLI.
- No `hydi outcome` CLI existed before Phase 26; operator had to use cockpit `review` which conflates measurement and approval.
