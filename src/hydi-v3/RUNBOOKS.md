# HYDI V3 Runbooks

## 1. Start HYDI V3

Use the `HYDIAutonomyManager` entry point. For example:

```js
const HYDIAutonomyManager = require('./src/hydi-v3');

const manager = new HYDIAutonomyManager({
  coreLoop,
  config: {
    enableWatchdog: true,
    enableHeartbeat: true,
    enableMissionPlanning: true,
    enableDecisionIntelligence: true,
    enableReflection: true,
    enableSelfHealing: true,
    enableDistributedCompute: true,
    enableMemoryIntegrity: true,
    enableObservability: true,
    enableSecurity: true,
  }
});

await manager.start();
```

The V3 layer patches the core loop and begins watchdog, heartbeat, mission planning,
reflection, self-healing, and observability automatically.

## 2. Graceful Shutdown

Press `Ctrl+C` or send `SIGTERM`. `boot-agent.js` already catches these signals and
calls `HYDISystem.shutdown()`, which stops the autonomy layer and persists a checkpoint.
If running `HYDIAutonomyManager` standalone, `GracefulShutdown` can be enabled with
`config.enableGracefulShutdown: true`.

## 3. Check System Status

```js
const status = await hydiSystem.autonomyManager.getStatus();
console.log(JSON.stringify(status, null, 2));
```

Or inspect the dashboard:

```js
const dashboard = hydiSystem.autonomyManager.getDashboard();
```

## 4. Create and Run a Mission

```js
const missionId = await manager.createMission('revenue-push', 'Launch outreach campaign');
manager.missionPlanner.addObjective(missionId, { description: 'Build contact list' });
const taskA = manager.missionPlanner.addTask(missionId, { type: 'automation', description: 'Find leads' });
const taskB = manager.missionPlanner.addTask(missionId, { type: 'outreach', description: 'Send email', dependencies: [taskA] });
await manager.executeMission(missionId);
```

The core loop will pick up ready tasks automatically via `getPendingTasks()`.

## 5. Watchdog Alerts

Listen on `manager.watchdog`:

- `agent_healthy` — normal heartbeat
- `agent_warning` — one or two non-critical issues
- `agent_dead` — critical issue or multiple failures; `SelfHealingEngine` is triggered
- `agent_recovered` — restart succeeded
- `agent_restart_failed` — escalate manually

## 6. Self-Healing

`SelfHealingEngine` reacts automatically to `agent_dead` and `heartbeat_missing`.
To manually heal a symptom:

```js
const result = await manager.selfHealing.heal(
  { type: 'database_disconnect', target: 'supabase' },
  { reconnect_database: async () => ({ success: true }) }
);
```

If `maxAttempts` is exceeded, `SelfHealingEngine` emits `escalated`.

## 7. Security Audit

```bash
npm run security-audit
```

The audit scans `src/hydi-v3` and `src/HYDISystem.js` for secrets, keys, and
dangerous patterns. It also reports environment-variable coverage and database
permission policy checks.

## 8. Memory Integrity Scan

```js
const result = await manager.runMemoryIntegrity();
// result.passed, result.issues, result.repairs
```

A scheduled scan runs every 24 hours by default. It checks reflective memory,
mission memory, agent memory, task memory, and conversation memory.

## 9. Performance Benchmark

```bash
npm run benchmark:performance
```

Benchmarks must report `meetsTargets` as `true` for startup, mission planning,
and task dispatch.

## 10. Long-Running Stability Simulation

```bash
npm run test:soak
```

Runs the `TestingFramework` scenarios: 60 simulated iterations, crash recovery,
power-loss checkpoint, DB disconnect, network outage, queue corruption, mission
replay, reflection replay, distributed execution, and memory serialization. Exits
non-zero if any scenario fails.

## 11. Production Readiness Checklist

1. `npm run lint` passes
2. `npm run typecheck` passes
3. `npm test` passes
4. `npm run test:integration` passes
5. `npm run benchmark:performance` passes
6. `npm run security-audit` passes
7. `npm run test:soak` passes
8. All required environment variables are set
9. Supabase `system_dashboard` view is healthy
10. `boot-agent.js` preflight passes

## 12. Executive Operator Surface

Two interfaces onto the same executive stack. Both boot an `OperatorSession`
(BusinessMemory → ExecutiveOperatingSystem → TaskEngine → BusinessWorkflowEngine
→ ExecutionGateway → ExecutiveCockpit) and render through `BriefingRenderer`,
so they always report identical state.

### Readline CLI

```bash
npm run cockpit                                   # interactive prompt
npm run cockpit:brief                             # one briefing, then exit
node scripts/operator-cli.js --priority resonate  # set owner priority at boot
node scripts/operator-cli.js --once "focus" --no-colour
node scripts/operator-cli.js --data-path ./data   # override persistence dir
```

Commands: `good morning`, `status`, `focus`, `approvals`, `history`,
`workflows`, `approve <id>`, `reject <id>`, `priority <p>`, `help`, `exit`.

Valid priorities: `resonate`, `operations`, `manufacturing`, `music`,
`research`, `revenue`, `creative`, `default`.

### Local Dashboard

```bash
npm run dev
# open http://localhost:3000/api/cockpit
```

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/cockpit` | GET | HTML briefing with a command console |
| `/api/cockpit/briefing` | GET | `{ briefing, model, text }` for integrations |
| `/api/cockpit/command` | POST | `{ text }` — one cockpit command |

The routes are **loopback only**. Non-local requests, and any request carrying
`X-Forwarded-For` / `X-Real-IP` / `Forwarded`, receive `403`. Do not put the
cockpit behind a reverse proxy — the guard treats a proxy hop as non-local by
design, and the surface exposes unredacted business memory and approval
controls.

Both surfaces route approvals through `ExecutionGateway` unchanged. Neither
grants any authority the gateway would otherwise withhold.

### Verifying the surface

```bash
npm run cockpit:brief        # expect a 13-section briefing
node scripts/minitest.js tests/unit/hydi-v3/OperatorSession.test.js
```

`scripts/minitest.js` is a minimal Jest-compatible runner for environments where
Jest cannot run (e.g. over a slow network mount). `npm test` remains
authoritative.

## 13. Operator CLI Run Modes and Shutdown

### Dry run

```bash
npm run cockpit:dry-run
node scripts/operator-cli.js --dry-run --once "approve exec_123"
```

Every mutating action is simulated or refused; nothing executes. Approvals are
routed to `ExecutionGateway.simulatePending()` and the pending action is left in
place, so you can preview and then really approve without re-queuing. A summary
of everything intercepted prints at shutdown.

Enforcement wraps the mutation authorities themselves — not the command parser —
so no rewording of a command can bypass it:

```
ExecutionGateway.execute / approve / reject / requestModification
BusinessWorkflowEngine.approveWorkflow / rejectWorkflow / startWorkflow
ConsoleAPI.backup
```

`focus` and `priority` are deliberately NOT guarded: they change what you see,
not what the system does.

### Offline

```bash
npm run cockpit:offline
```

Refuses network-dependent action types at the call boundary and prints a
startup preflight. Every such type is already `forbidden` in the gateway's
classification, so the preflight normally reports "verified local-only"; it
exists to catch an adapter registered at runtime that reintroduces a network
path. Combine with `--dry-run`; offline refusal takes precedence.

### Graceful shutdown

Ctrl-C (or `exit`) drains in this order:

1. stop accepting input
2. finish the in-flight command, bounded by `--shutdown-timeout` (default 10000ms)
3. persist command history into SessionMemory
4. flush every store, then destroy the session
5. exit 0 on a clean drain, 1 if the drain timed out or a flush failed

A second Ctrl-C exits immediately with 130, so a wedged flush cannot trap you.

### History

Up/Down recalls commands from previous sessions. History is stored in
SessionMemory (`data/session-memory.json`), capped, de-duplicated, and skips
blank lines. Disable with `--no-history`.

## 14. Git Sensor

Publishes git activity to `BusinessEventBus`, where the existing
`BusinessSignalInterpreter` turns it into `BusinessSignal`s that the Executive
OS already consumes. The Executive OS has no knowledge that git exists.

```bash
node scripts/operator-cli.js --git                        # watch cwd
node scripts/operator-cli.js --git /path/to/repo --git-project "Resonate"
node scripts/operator-cli.js --git . --git-poll 30000     # poll every 30s
node scripts/operator-cli.js --git . --git-poll 0         # manual poll only
```

Without `--git` no sensor starts and the bus carries no git events.

**Set `--git-project` to a strategic objective name.** It defaults to the
directory name; for this repo that is `HYDI_System`, which matches no objective,
so commits would score as `default` rather than `operations`.

### Event types

| Event | Impact |
| --- | --- |
| `CommitCreated` | `engineering-delivered` |
| `BranchCreated` | `engineering-started` |
| `BranchDeleted` | `engineering-closed` |
| `BranchStale` | `risk-stale` |
| `WorkingTreeDirty` | `risk-uncommitted` |
| `WorkingTreeClean` | `engineering-progress` |

### Behaviour to expect

- **First run publishes no commits.** HEAD is adopted as a baseline so history
  is not replayed as fresh activity. Present-state facts — stale branches and
  uncommitted work — *are* reported on the first run, because they describe now.
- **A steady repository produces zero events.** Everything is edge-triggered
  against the previous poll, so polling frequently does not create noise.
- **Restarting does not replay.** The cursor is persisted to
  `data/git-sensor-<project>.json`. If it becomes unknown (rebased away, or a
  store copied between repositories) the sensor falls back to a cold read rather
  than breaking.
- **No git, or not a repository, is not an error.** The sensor reports itself
  inactive with a reason and never gates session health.

### Safety

`GitRepository` is read-only by construction: it uses `execFile` (no shell, so
commit messages and branch names cannot inject commands) and permits only
`rev-parse`, `log`, `show`, `status`, `for-each-ref`, and `symbolic-ref`.
`commit`, `push`, `reset`, `clean`, and `checkout` are refused.

## 15. Signal Coverage

More than one interpreter now sits on the bus (`BusinessSignalInterpreter` for
filesystem and git, `ManufacturingSignalInterpreter` for hardware). Each
subscribes to `*` and self-selects, so two silent failures are possible:

- **Dropped** — no interpreter handles a type. The event reaches the bus,
  nothing translates it, it never appears in a briefing, and nothing errors.
- **Double-translated** — two interpreters handle the same type. One
  occurrence is counted twice in the briefing, activity ledger, and audit trail.

`SignalCoverage` detects both by probing the interpreters with a synthetic
event per known sensor type.

```bash
# Enforced in CI
npx jest tests/unit/hydi-v3/SignalCoverage.test.js
```

The audit also runs at `OperatorSession` startup; a problem is logged and
`healthCheck().checks.signalCoverage` goes false.

### Adding a sensor event type

1. Emit it from the sensor.
2. Add it to `SENSOR_EVENT_TYPES` in `src/hydi-v3/SignalCoverage.js`.
3. Add a case to exactly one interpreter.

Skipping step 3 fails the coverage test. Skipping step 2 fails the inventory
drift test, which cross-checks the declared list against the `_emit(...)` calls
in each sensor's source — without it, a narrowed inventory would defeat the
coverage check itself.

### Adding a whole interpreter

Give it a `default: return null` branch. An interpreter that returns a signal
for types outside its domain will be caught as `DOUBLE`, not silently
double-count.

## 16. Continuous Learning

Every recommendation, execution, and outcome is recorded by the continuous
learning layer (`DecisionOutcomeStore`, `RecommendationTracker`,
`BusinessOutcomeEngine`, `ConfidenceCalibration`, `LearningMetrics`).

```bash
# Cockpit learning dashboard
npm run cockpit
# then type: learning
```

The dashboard shows prediction accuracy, recommendation success rate, confidence
trend, top performing agents, lowest-confidence areas, recent lessons, and
recommendation history. Morning briefings include a `learningSummary` after the
recommendations section; `TrustEngine.formatJustification()` now answers
"Why do you believe this?", "How often has this succeeded?", and
"What would change your recommendation?".

### Outcome lifecycle

- `ExecutiveOperatingSystem` tracks every recommendation it generates.
- `ExecutionGateway.observeAction()` records a completed/failed action outcome
  when an executed action carries `recommendationId`.
- `BusinessWorkflowEngine.recordOutcome()` feeds workflow outcomes back through
  `BusinessOutcomeEngine.observeWorkflow()`.
- `BusinessOutcomeEngine` classifies the outcome, computes impacts, calibrates
  confidence, and stores the lesson.

### Policies

Confidence calibration uses one of four policies: `Conservative`, `Balanced`,
`Aggressive`, `Experimental`. A policy controls learning rate, confidence
adjustment strength, evidence threshold, recommendation threshold, and
confidence bounds. The default is `Balanced`.

## 16. Learning Loop

Observed outcomes adjust the confidence of future recommendations. This is the
one component where being wrong compounds, so it has hard rules.

### What counts as evidence

| Event | Effect |
| --- | --- |
| Action executed successfully | execution status only — **not** an outcome |
| Action failed to execute | outcome `failed` (it cannot deliver value) |
| Real value measured and reported | outcome, classified against `expectedValue` |
| Anything under `--dry-run` or `simulate` | nothing at all |

An action finishing means it *ran*, not that it delivered the value the
recommendation predicted. Recording completion as success would let the system
confirm its own forecast without observing anything — the failure mode that
broke V1. Recommendations therefore sit in `getAwaitingOutcomes()` until a real
measurement arrives.

Outcomes carry `measured` and `provenance` so inferred and observed claims stay
distinguishable.

### Recording a real outcome

```js
session.businessOutcomeEngine.recordOutcome(recommendationId, { value: 8200 });
```

Outcomes are **terminal**. A second call is ignored — neither a new row nor a
confidence change — so a retried execution cannot fabricate evidence. To
correct a recorded outcome, pass `{ supersede: true }`.

### Inspecting and reversing

```js
store.getConfidenceHistory(id);   // every adjustment, with its reason
store.getLearningSummary();       // totals over a window
store.getAwaitingOutcomes();      // recommendations with no measurement yet
```

Confidence is clamped to the active policy's min/max
(`src/hydi-v3/LearningPolicies.js`). Deltas scale by `(1 - confidence)` on
success and `confidence` on failure, so repeated evidence asymptotes rather than
running away. A single outcome moves confidence by roughly 0.005 under the
`balanced` policy.

Switching policy changes only future adjustments; recorded history is unaffected.

## 17. Evidence Capture

Evidence is how a recommendation stops awaiting an outcome. The layer draws a
hard line between two different claims:

| Claim | Sets | Leaves null |
| --- | --- | --- |
| **Classification** — "yes, that worked" | `outcomeType`, confidence | `actual`, `impacts.revenue` |
| **Measurement** — a number | `outcomeType`, confidence, `actual`, impacts | — |

An owner confirmation is a real judgement but not a measurement. Recording it as
one meant a confirmed success also booked a revenue impact of minus the entire
expectation. Evidence with no `data.value` therefore classifies without
quantifying, and `measured` reflects which kind of claim was made.

### Supplying evidence

```js
// Measurement — carries a number.
session.evidenceEngine.addEvidence(recId, {
  source: 'stripe', type: 'revenue', weight: 1, confidence: 1, relevance: 1,
  at: Date.now(), data: { value: 9500 },
});
session.evidenceEngine.evaluateRecommendation(recId);

// Classification — owner review.
session.evidenceEngine.submitManualReview(recId, 'Yes');  // Yes | Partially | No | Unknown | Skip
```

`Unknown` and `Skip` record nothing, by design.

### What produces no outcome

- no evidence at all
- evidence below `qualityThreshold` (default 0.3)
- evidence where nothing carries a number → `Inconclusive`
- contradictory measurements (coefficient of variation > 0.8) → `Inconclusive`

`outcomeType: null` always means nothing was written.

### Re-evaluation

Outcomes remain terminal (see Runbook 16). Calling `evaluateRecommendation()`
repeatedly cannot add rows or move confidence. Correct a recorded outcome with
`{ supersede: true }` via the outcome store.

### Writing a new evidence provider

If you cannot supply a number, do not claim one — omit `data.value` rather than
passing `0`. Zero is a measurement meaning "nothing was produced", which is a
different statement from "this was not measured".
