# Changelog

All notable changes to HYDI System v2 are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Phase 18C — Physical Operations Sensor Framework (Manufacturing Intelligence): added `src/hydi-v3/EquipmentRegistry.js` (mock ProtoForge equipment catalog), `src/hydi-v3/EquipmentSensor.js` (hardware-only base sensor), `src/hydi-v3/PrinterSensor.js` (3d-printer monitoring with simulated mode and an adapter interface for OctoPrint/Moonraker/Klipper), and `src/hydi-v3/ManufacturingSignalInterpreter.js` (translates `PrinterStarted`, `PrinterPaused`, `PrinterResumed`, `PrinterCompleted`, `PrinterFailed`, `PrinterIdle`, `PrinterHeating`, and `MaterialLow` into `BusinessSignal` events). `ExecutiveOperatingSystem` required no changes — a regression test asserts its source contains no printer, hardware, or vendor-specific terms. The `ObservabilityDashboard` now exposes `manufacturingStatus` derived from `BusinessSignal` events, and `OperatorSession` wires the printer sensor through the event bus when `--simulate-manufacturing` is passed. See `reports/business-os/phase18c-manufacturing-signals.md`.
- Phase 18C — Git Sensor: added `src/hydi-v3/GitRepository.js` (read-only git accessor: `execFile` so there is no shell, plus an allowlist of `rev-parse`/`log`/`show`/`status`/`for-each-ref`/`symbolic-ref`, bounded timeout and stdout cap) and `src/hydi-v3/GitSensor.js`, which polls a working copy and publishes `CommitCreated`, `BranchCreated`, `BranchDeleted`, `BranchStale`, `WorkingTreeDirty`, and `WorkingTreeClean` to `BusinessEventBus`. `ExecutiveOperatingSystem` required no changes — a test asserts its source contains no occurrence of "git". A cold start adopts HEAD as a baseline so history is never replayed, while present-state facts (stale branches, uncommitted work) still publish on first run; everything else is edge-triggered, so a steady repository produces zero events. The cursor persists across restarts and falls back to a cold read if it becomes unknown. Added `--git [path]`, `--git-poll <ms>`, and `--git-project <name>` to the operator CLI, and `tests/unit/hydi-v3/GitSensor.test.js` (31 tests against real temporary git repositories). See `reports/business-os/phase18c-git-sensor.md`.
- Phase 16 — Operator CLI Production Readiness: added `src/hydi-v3/OperatorMode.js` (enforces `--dry-run` and `--offline`) and `src/hydi-v3/OperatorRuntime.js` (readline loop, serialised command queue, persisted history, signal handling, bounded graceful shutdown). Dry run wraps the closed set of mutation authorities — `ExecutionGateway.execute/approve/reject/requestModification`, `BusinessWorkflowEngine.approveWorkflow/rejectWorkflow/startWorkflow`, and `ConsoleAPI.backup` — rather than classifying command text, so no rewording can bypass it; approvals route to the gateway's existing `simulatePending()` and no new execution path is introduced. Offline mode refuses network-dependent action types at the call boundary and runs a startup preflight that detects a runtime-registered network-capable adapter. Command history is seeded from and saved back to `SessionMemory`, so arrow-key recall survives a restart without a second source of truth. Added `npm run cockpit:dry-run` / `cockpit:offline`, and `tests/unit/hydi-v3/OperatorMode.test.js` (19 tests) and `tests/unit/hydi-v3/OperatorRuntime.test.js` (17 tests). See `reports/business-os/phase16-operator-production-readiness.md`.
- Phase 14B — Unified Operator Surface: added `src/hydi-v3/BriefingRenderer.js` as the single source of truth for briefing presentation (`toSections()` produces a format-neutral model rendered by `toText()`/`toAnsi()`/`toHtml()`), `src/hydi-v3/OperatorSession.js` to boot the full executive stack with one shared `StrategicObjectives` instance, `src/hydi-v3/OperatorCLI.js` for I/O-free command handling, `src/hydi-v3/localAccessGuard.js` for loopback-only route access, `src/hydi-v3/cockpitSession.js` for a hot-reload-safe route session, `scripts/operator-cli.js` (`npm run cockpit`) for the readline prompt, and `pages/api/cockpit/{index,briefing,command}.js` for the localhost dashboard. The owner can now type "Good morning" and receive the full executive briefing from either surface. Added `scripts/minitest.js`, a minimal Jest-compatible runner for environments where the Jest crawler is unavailable. Added `tests/unit/hydi-v3/BriefingRenderer.test.js` (16 tests), `tests/unit/hydi-v3/OperatorSession.test.js` (20 tests), and `tests/unit/hydi-v3/localAccessGuard.test.js` (9 tests). See `reports/business-os/phase14b-operator-surface.md`.
- Secret redaction and correlation-ID propagation (`AsyncLocalStorage`) in `lib/structured-logger.js`, plus its first test coverage (`tests/unit/structured-logger.test.js`, 11 tests). See `ISSUES_FOUND.md` #72.
- End-to-end shutdown and recovery test suite `tests/unit/hydi-v3/ShutdownRecovery.test.js` covering graceful shutdown persistence, restart state restoration, repeated start/stop cycle integrity, and `GracefulShutdown`-coordinated flush with recovery-time assertions.

### Changed
- Phase 18C — `OperatorSession` now constructs `BusinessEventBus` and `BusinessSignalInterpreter` and passes the bus to `ExecutiveOperatingSystem`; sensors are opt-in, are torn down before the components they feed, and the interpreter is detached and the bus destroyed after teardown. `BusinessSignalInterpreter` gained interpretations and impact classes for the six git event types. `scripts/minitest.js` gained `done`-callback support and the `toHaveBeenCalled*` matchers.
- Phase 16 — `OperatorSession` gained `flushAll()` and `shutdown()` (flush every store before destroying, reporting per-component failures instead of throwing) and now installs an optional `OperatorMode` last in `start()`, so every surface built on a session inherits the same dry-run/offline guarantees. `SessionMemory` gained `getRecentCommands(limit)`. `scripts/operator-cli.js` reduced to argv parsing and wiring; the terminal lifecycle moved into `OperatorRuntime` so it is unit-testable with injected streams. New flags: `--dry-run`, `--offline`, `--no-history`, `--shutdown-timeout`.
- Phase 14B — `ExecutiveOperatingSystem.toText()` now delegates to `BriefingRenderer`, removing the ~50-line inline formatter that would otherwise have been duplicated by the web surface; added `toSections()`. `src/hydi-v3/index.js` now exports the executive layer (`BusinessMemory`, `ExecutiveOperatingSystem`, `ExecutiveCockpit`, `StrategicObjectives`, `BriefingRenderer`, `OperatorSession`, `OperatorCLI`, `localAccessGuard`), which was previously unreachable through the package entry point. Extended `lint:hydi-v3` and `tsconfig.typecheck.json` scope to the new routes and script.
- Migrated `console.*` logging to the structured logger in `workers/` (all 19 files, 302 calls) and mostly in `agents/`/`revenue-engine/` (118 of 204 calls; the rest is deliberately-preserved interactive CLI output). `src/`, `api/`, `lib/`, `pages/` still use `console.*` and are tracked as a follow-up (`ROADMAP.md` near-term item 11).
- Expanded `next.config.js`'s `eslint.dirs` to cover `workers/`, `agents/`, `revenue-engine/`, `api/`, `kilo/` — `npm run lint` (and therefore CI's lint gate) had silently never scanned them before. Set `no-console` to `"warn"`.
- Standardized HYDI V3 persistence lifecycle across `MissionPlanner`, `DecisionIntelligence`, and `ReflectionEngine`: added `flush()` for immediate shutdown persistence, tracked `_persistInFlight` to avoid serializing empty/cleared state during `destroy()`, and made `AutonomyManager.destroy()` async so it awaits `stop()` before tearing down subsystems. `AutonomyManager.persistAll()` now calls `flush()` on each store to guarantee no buffered writes are lost at shutdown.
- Added persistence observability metrics to `ObservabilityDashboard` (`recordFlush`, `recordShutdown`, `recordRecovery`) and wired `AutonomyManager.start()`/`stop()`/`persistAll()` to emit flush duration, pending writes, failed persists, shutdown duration, and recovery duration. These are exposed in `getDashboard()`, `getStatus()`, and `getPersistenceMetrics()`.

### Fixed
- The Phase 18A/18B sensing layer was never wired into the running system: `BusinessEventBus`, `FilesystemMonitor`, and `BusinessSignalInterpreter` existed and were tested, but nothing outside the test suite constructed a bus, so `OperatorSession` had no reference to any of them. The bus was the single integration boundary in design only. `OperatorSession` now builds and wires it in production.
- `ExecutiveOperatingSystem.recentActivitySummary()` reported activity counts but discarded the human-readable interpretation each signal carries, so a commit and a deleted branch read identically as "1 activity signal for resonate". A "Most recent" tail now lists the three latest interpretations; the existing aggregate lines are unchanged and still come first.
- Phase 16's own shutdown timeout timer was initially `unref()`'d, which meant Node could exit silently with status 0 the moment a stalled command was the last thing holding the event loop open — reporting the exact failure the timeout exists to catch as a success. Caught by exercising the drain path outside a test harness; the timer is no longer unref'd and a regression test drives shutdown with no other handles present.
- `ExecutionGateway.approve()` ignored the gateway-wide `simulate` config, passing `false` unconditionally to `_runEntry()`. A gateway constructed with `simulate: true` would therefore simulate `execute()` but perform real side effects on approval — any caller trusting that flag was silently unprotected on the approval path. Found while building Phase 16's dry-run mode; fixed and covered by a regression test.
- Phase 14B verification found and fixed three defects: `localAccessGuard.isLocalRequest()` treated a request with no peer address as local (empty string was in the loopback set) and now fails closed; `ExecutiveOperatingSystem._executiveSummary()` computed a two-state health while the renderer computed three, so a briefing could print "ProtoForge status: watch" above "ProtoForge is stable" — both now use `BriefingRenderer.healthOf()`; and the operator CLI's async readline handlers raced under piped input, allowing `exit` to shut the session down before earlier commands finished printing — now serialised through a promise chain. All three have regression coverage.
- Eliminated all 201 `no-unused-vars` ESLint warnings across 49 files in `pages/`, `components/`, `lib/`, `src/` (`ROADMAP.md` P2 #8, `ISSUES_FOUND.md` #71). Two entirely dead functions removed (`src/queue/RedisStreamBroker.js`'s `redisCommand`, `src/server.js`'s `persistEventToDatabase`); no exports, signatures, or runtime behavior changed.
- Corrected `ISSUES_FOUND.md` #19's stale status — the `WatchdogSupervisor.test.js` flaky-race fix had already landed in a prior commit but was still documented as open.
- 4 real runtime bugs found by the lint-scope expansion above, all previously invisible to CI: an undefined-variable `ReferenceError` in `workers/InventoryMaterialsWorker.js`'s material-reservation insert, a `ReferenceError` on every *successful* task completion in `revenue-engine/revenue-engine-v2.js`'s `executeTask()`, and a `TypeError`-on-certain-inputs `const` reassignment bug in two `agents/specialized/business-agents.js` revenue calculators. See `ISSUES_FOUND.md` #74.
- Debounced `persist()` in `MissionPlanner`, `DecisionIntelligence`, and `ReflectionEngine` to eliminate O(n) file writes per mutation, cancel pending writes on `destroy()`, and resolve the `ArchitectureAudit` warning about unawaited async persists. `tests/unit/hydi-v3/PerformanceBenchmark.test.js` now passes (dropped from ~30s to ~6s) and the `reports meet targets` test has an explicit 30000ms timeout aligned with the suite's long-running benchmark tests.
- Fixed incorrect named-destructuring imports of `LocalModelAdapter` in `src/models/heartbeat.js` and `modules/ursula-service-bundle.js`; `src/models/local-model-adapter.js` exports the class as `module.exports`, so `require(...).LocalModelAdapter` was `undefined` and `new LocalModelAdapter()` threw "LocalModelAdapter is not a constructor". The heartbeat now initializes correctly and `subscription-manager.test.js` / `ursula-service-bundle.test.js` no longer log that error.
- Completed lifecycle cleanup across `HeidiCoreLoop`, `HybridModelStack`, `SubscriptionManager`, `HeidiMemorySystem`, `UrsulaServiceBundle`, `LocalModelAdapter`, `heartbeat`, and `HeidiActionLayer`: all `setTimeout`/`setInterval` handles are now tracked and cleared, `destroy()` methods propagate to subsystems, recurring loops are gated by `_destroyed`/`isRunning`, and `jest.config.js` no longer relies on `forceExit` (`forceExit: false`, `detectOpenHandles: true`). Full `npm test` suite now exits cleanly with no worker-process warnings.
- Phase 2 lifecycle audit: added `stop()`/`destroy()` to `workers/SyncWorker`, `workers/EventBusWorker`, `src/middleware/model-rate-limiter.js`, `src/services/subscription-cache.js`, `src/memory/MemoryBuffer.js`, `src/revenue/HeidiRevenueEngine.js`, `src/hydi-v3/CudaPoolManager.js`, `src/hydi-v3/ObservabilityDashboard.js`, and `src/actions/HeidiActionLayer.js`; `AutonomyManager.destroy()` now propagates to `cudaPoolManager`, `actionLayer`, `observability`, `memorySystem`, `modelStack`, `coreLoop`, and `securityAuditor`. Added regression coverage in `tests/unit/lifecycle-cleanup.test.js`.
- Expanded `ObservabilityDashboard` lifecycle metrics (`recordActiveTimers`, `recordPendingPromises`, `recordQueuedPersistence`, `recordShutdownLatency`, `recordStartupLatency`, `recordRestartLatency`, `recordCleanupFailure`, `recordRecoverySuccess`, `getLifecycleMetrics`) and wired `AutonomyManager.start()`/`stop()` to record startup/shutdown latency.
- Phase 3 process/worker reliability audit: `HeidiActionLayer.executeScript()` now tracks child processes, enforces a configurable timeout, drains stdout/stderr, kills on `destroy()`, and cleans up listeners; `lib/realtime/eventBus.js` exposes `reset()` and `getListenerCount()`; `lib/health-monitor.js` adds `stop()`/`destroy()` and idempotent component registration; `lib/error-recovery.js` makes `setupGlobalErrorHandlers()` idempotent and adds `uninstallGlobalErrorHandlers()`; `workers/resource-enforcement.js` `EnforcedWorker` and `WorkerResourceMonitor` now clear intervals and remove listeners on termination/destroy. Added regression coverage in `tests/unit/process-lifecycle.test.js` and updated `scripts/lifecycle-stress-v3.js` to 1,000 `AutonomyManager` start/stop cycles.
- Phase 4 remaining resource integrity & Event lifecycle audit: `lib/rate-limit.js` now exposes `startSweeping()` and `stopSweeping()`; `__reset()` stops the background sweep interval in addition to clearing buckets; `src/models/local-model-adapter.js` now tracks all spawned model processes, enforces per-call timeouts, captures stderr, removes child listeners on close, and kills outstanding tracked processes on `destroy()`. Regression coverage added in `tests/unit/process-lifecycle.test.js` (rate-limit sweep and `LocalModelAdapter` child process cleanup/timeout/destroy); `scripts/lifecycle-stress-v3.js` increased to 5,000 `AutonomyManager` start/stop cycles.
- Phase 5 final runtime hardening & production readiness: `heidi-core/server.js` `startBrainWatchdog()` is now idempotent, stores its interval and the revived Ollama process, and `stopBrainWatchdog()` clears the interval and kills the process; SIGINT/SIGTERM both close the HTTP server and stop the watchdog; `modules/recovery-engine.js` `executeCommand()` now tracks active recoveries, clears its timeout, and removes child listeners, and `destroy()` terminates active recoveries and clears all state; `modules/workflow-orchestrator.js` and `agents/specialized/agent-factory.js` gained `destroy()` methods; `src/audit/SystemAuditor.js` and `src/enforcement/RuntimeEnforcer.js` `execSync` calls now have 30s timeouts. `scripts/lifecycle-stress-v3.js` increased to 10,000 `AutonomyManager` start/stop cycles.
- Phase 6, milestone 1 — Autonomous Task Engine: added `src/hydi-v3/TaskEngine.js`, a persistent, dependency-aware, crash-recoverable task queue with priority ordering, DAG execution, configurable retry with exponential backoff, rollback/cancel semantics, atomic JSON persistence with corruption archiving, lifecycle-safe `start`/`stop`/`destroy`, and `getHealthReport()` for operator observability. Fixed the crash-recovery zombie-running defect: persisted `running` tasks are now recovered to `pending` on startup, dependents re-evaluate correctly, and the scheduler cannot deadlock. Expanded `tests/unit/hydi-v3/TaskEngine.test.js` to 18 tests covering interruption recovery, retry policy, cancellation, health reporting, corrupted persistence, and a 500-interrupted-task crash simulation.
- Phase 7, milestone 1 — Autonomous Engineering Platform: added `src/hydi-v3/ProjectPlanner.js` for project planning, milestone generation, dependency graph construction, and engineering backlog management. Projects are decomposed into the required workflow `Analyze → Plan → Implement → Test → Benchmark → Document → Commit → Report`, with per-goal priority, backlog filtering/sorting, `prioritize()`, `addBacklogItem()`, and `getStatus()` observability. Persistence is atomic, versioned, and hardened with corrupt-store archiving. `toTaskEngine()` exports plans directly into the existing `TaskEngine` for execution, integrating planning with runtime, memory, and lifecycle systems. Added `tests/unit/hydi-v3/ProjectPlanner.test.js` with 12 tests including lifecycle, dependency chain, backlog, prioritization, TaskEngine execution, persistence, corruption recovery, and a 50-project benchmark.
- Phase 8, milestone 1 — ProtoForge Executive Operating System (local-first): added `src/hydi-v3/BusinessMemory.js`, a unified graph memory for projects, clients, vendors, equipment, opportunities, and tasks. Supports typed relationships, search/filter, atomic local JSON persistence, lifecycle-safe `initialize`/`start`/`healthCheck`/`flush`/`stop`/`destroy`, and `rankOpportunities()` for scoring next highest-value actions by value, risk, and effort. Added `tests/unit/hydi-v3/BusinessMemory.test.js` with 11 tests covering lifecycle, CRUD, relationships, ranking, persistence, corruption recovery, edge cases, and a 1000-entity benchmark. No cloud or external dependencies.
- Phase 9, milestone 1 — Business Orchestration Engine: added `src/hydi-v3/BusinessWorkflowEngine.js` and `BusinessValueScorer` to convert Executive OS recommendations into approval-gated, agent-assigned, executable workflows. Supports sales, manufacturing, research, creative, finance, and technical workflow templates; `getRankedRecommendations()`; `getPreparedActions()`; `approveWorkflow()`; `startWorkflow()` dispatching to `TaskEngine`; `recordOutcome()` for the learning loop; and local JSON persistence. Added `tests/unit/hydi-v3/BusinessWorkflowEngine.test.js` with 12 tests covering creation, recommendation conversion, approval gates, `TaskEngine` dispatch, custom step handlers, outcomes, persistence, corruption recovery, and a 100-workflow benchmark.
- Phase 13 — Operational Execution Gateway: added `src/hydi-v3/ExecutionGateway.js` and `src/hydi-v3/CapabilityAdapters.js` to provide a controlled execution layer between HYDI decisions and real-world effects. Implements capability adapters for documentation, file operations, development, and communication preparation; `autonomous`/`review-required`/`forbidden` action classes; explicit approval/rejection; simulation mode; audit logging; `getExecutionHistory()`, `getPendingApprovals()`, and `getDashboardData()`. Added `tests/unit/hydi-v3/ExecutionGateway.test.js` with 14 tests covering lifecycle, capabilities, autonomous execution, approval gates, forbidden actions, simulation, audit fields, dashboard, persistence, corruption recovery, adversarial bypass attempts, and a 100-execution benchmark.
- Phase 14A — Strategic Objective Framework & Resonate Integration: added `src/hydi-v3/StrategicObjectives.js` as the single configurable registry for business priorities (Resonate, ProtoForge Operations, Manufacturing, Music, Research). Refactored `BusinessMemory._score()`, `ExecutiveOperatingSystem.morningBriefing()`/`toText()`/`getObjectiveStatus()`, `ExecutiveAgents` `ProductManager`, `BusinessWorkflowEngine.getRankedRecommendations()`, and `ExecutiveCockpit` to consume the framework. Expanded executive briefing to include Executive Summary, Strategic Objectives, Resonate Status, Operations/Sales/Manufacturing/Research/Creative/Financial sections, Critical Risks, Top Opportunities, Recommended Actions, and Missing Data. Added `tests/unit/hydi-v3/StrategicObjectives.test.js` and updated `ExecutiveOperatingSystem.test.js` and `ExecutiveCockpit.test.js` for owner-priority switching and Resonate weighting.
- Phase 15 — Data Integrity & Startup Integrity: added `src/hydi-v3/DataIntegrity.js` for normalizing and validating risk (`0-1`, `0-100%`, `1-5`, `1-10`, `low/medium/high`), probability, confidence, strategic weight, value, cost, revenue, and effort; wired into `BusinessMemory.put()` and `_hydrateEntity()` with persisted `PERSISTENCE_VERSION` bump and on-load migration. Added `src/hydi-v3/StartupIntegrity.js` for a pre-flight executive startup check and integrated it into `ExecutiveCockpit` as `startup`/`health` commands. Also fixed `ConversationEngine._whatAbout()` to resolve flagship objectives first and `ExecutiveTimeline.list()` to keep newest-first ordering with tie-breaker sequences. Added `tests/unit/hydi-v3/DataIntegrity.test.js` and `tests/unit/hydi-v3/StartupIntegrity.test.js`; expanded `BusinessMemory.test.js` with invalid-input rejection, normalization, ranking-corruption, and migration tests.
- Phase 17 — Trust, Provenance & Justifiable Decisions: added `src/hydi-v3/AuditLedger.js` (append-only, hash-chained, tamper-detectable audit log), `src/hydi-v3/TrustEngine.js` (confidence scoring, recommendation provenance, explicit `iDontKnow()`), and `src/hydi-v3/ActionSnapshot.js` (before/after diffs). Wired `AuditLedger` into `ExecutionGateway` for every `execute`/`approve`/`reject`/`await-approval` event with `beforeState`/`afterState` diffs. Added `confidence` and `provenance` fields to `ExecutiveOperatingSystem.recommendations()` and enhanced `ConversationEngine._explainRecommendation()` to answer why, why safe, data sources, assumptions, expected outcome, changes, and undoability. Confirmed `ExecutionGateway.approve()` already honours `simulate` and added regression coverage. Added `tests/unit/hydi-v3/AuditLedger.test.js`, `TrustEngine.test.js`, and `ActionSnapshot.test.js`.
- Phase 18A — Business Event Bus & Filesystem Monitor: added `src/hydi-v3/BusinessEventBus.js` (typed pub/sub with wildcard, history, and replay), `src/hydi-v3/FilesystemMonitor.js` (scans configured project roots and emits `ProjectOpened`/`FileCreated`/`FileModified`/`FileDeleted`/`DirectoryCreated` events with exclude patterns and OS-native watch fallback), and `src/hydi-v3/BusinessSignalInterpreter.js` (maps filesystem facts into `BusinessSignal` interpretations with strategic objective, subsystem, file category, confidence, and impact). Exported from `src/hydi-v3/index.js`. Added `tests/unit/hydi-v3/BusinessEventBus.test.js`, `FilesystemMonitor.test.js`, and `BusinessSignalInterpreter.test.js`.
- Phase 18B — Business Signal Integration: wired `BusinessEventBus` into `ExecutiveOperatingSystem` so `BusinessSignal` events are automatically written as `activity` entities in `BusinessMemory`, recorded in `ExecutiveTimeline`, and, if configured, appended to `AuditLedger`. Added `ExecutiveOperatingSystem.recentActivitySummary()` and updated `morningBriefing()` with a `Recent Activity` section rendered by `BriefingRenderer`. Added `ExecutiveCockpit.whatChanged()` and `ConversationEngine._whatChanged()` now answers from live business signals instead of the timeline. Updated `DataIntegrity.VALID_TYPES` and `BusinessMemory.ENTITY_TYPES` to include `activity`, and `BusinessMemory.find()` gained a `since` filter. Added `tests/unit/hydi-v3/ExecutiveOperatingSystem.test.js` test for end-to-end event consumption.

## [2026-06-27] — Documentation suite expansion

### Added
- `.github/ISSUE_TEMPLATE/pipeline-violation.md` — dedicated template for reporting pipeline layer boundary violations (KILO executing, Emission Layer adding logic, ledger mutation, Replay non-determinism, cooldown bypass), with evidence fields and reproduction steps
- `GOVERNANCE.md` — RFC process for significant changes (pipeline contract, schema, architectural constraints); new agent/worker approval policy requiring WorkerOrchestrator registration; security reference; see-also footer
- `SUPPORT.md` — issue template selection guide; "What to expect" section (response timings, urgency tiers, RFC pointer); see-also footer

### Changed
- `.github/PULL_REQUEST_TEMPLATE.md` — enriched with pipeline integrity checklist, DB migration section (migration test requirement, STATE_MACHINE_APPROVED gate, `.sql.skip` convention), worker registration check, `npm run typecheck` step, `SUPABASE_SERVICE_ROLE_KEY` server-side constraint, `unknown` catch guard, Edge Function ESM purity, `system_dashboard` stability, `nnotification.service.ts` rename warning
- `.github/ISSUE_TEMPLATE/bug_report.md` — added pipeline layer/subsystem checkboxes, `npm run typecheck` output field, log safety reminder
- `.github/ISSUE_TEMPLATE/feature_request.md` — added full pipeline layers checklist and pipeline constraint check section
- `CONTRIBUTING.md` — added first-time contributors section, `./verify-supabase.sh` note in migration checklist, changelog policy section, see-also table
- `SECURITY.md` — added GitHub private security advisory as preferred channel, coordinated disclosure timeline table, see-also footer
- `CODE_OF_CONDUCT.md` — added reporter confidentiality paragraph, see-also footer

## [2026-06-22] — Documentation suite

### Added
- `CLAUDE.md` — comprehensive AI assistant reference covering pipeline architecture, API routes, workers, DSL policy engine, and ops scripts
- `README.md` — rewritten to reflect current architecture (six-layer pipeline, named agents, API routes, Edge Functions, CI workflows)
- `.cursorrules` — prescriptive Cursor IDE AI rules covering pipeline constraints, KILO execution prohibition, PolicyEngine fail-closed, TypeScript conventions, and secret handling
- `AGENTS.md` — autonomous AI agent guidelines covering verification commands, codebase navigation, and hard constraints
- `CONTRIBUTING.md` — full contributor guide with setup, PR checklist, DB migration governance, and CI summary
- `SECURITY.md` — vulnerability reporting process, scope, known limitations, and security controls
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1

## [2026-06-19] — Worker stability fix

### Fixed
- Restored `DecisionAssistWorker` registration in `WorkerOrchestrator.js` — omission was causing a startup crash loop

## [2026-06-18] — Mobile status endpoint + stream health watchdog

### Added
- `api/mobile-status.js` — compact, 3G-safe single-round-trip endpoint returning `{ ok, alert, system, drift, heals_24h, streams, silent, ms, ts }`
- `supabase/functions/stream-health-watchdog/` — Edge Function monitoring Redis stream health

## [2026-06-17] — Security hardening: SECURITY DEFINER search_path

### Security
- Pinned `search_path` on 17 `SECURITY DEFINER` functions across Supabase migrations to prevent SQL injection via search path manipulation (#88)

## [2026-06-16] — DSL policy engine, KILO entry point, ops tooling

### Added
- `kilo/index.js` — CommonJS entry point for the KILO hypothesis generator; exports `{ KiloEngine, createKiloEngine }`; `execute()` throws unconditionally (KILO never acts)
- `lib/protoforge/policy-engine.js` — DSL rule evaluator with operators `gte`, `lte`, `gt`, `lt`, `eq`, `neq`, `in`, `nin`; fail-closed (default `'reject'`); hot-reloads via Supabase Realtime
- `lib/protoforge/auto-gate.js` — automatic wrapper that runs PolicyEngine on every KILO output before Emission Layer
- `supabase/functions/protoforge-calibration/` — calibration feedback loop adjusting rule weights via `calibrate_protoforge_decisions()` RPC
- `workers/DecisionAssistWorker.js` — polls for decision-assist tasks across financial_planning, resource_allocation, risk_assessment, system_optimization
- `verify-supabase.sh` — health check script verifying Supabase connectivity and key tables

### Fixed
- CI action versions pinned to v4 to resolve broken `clean-main` CI (#86)

### Security
- Resolved multiple npm CVEs (form-data CR/LF escape, tar PAX header, postcss)

## [2026-05-28–29] — KILO→ProtoForge automatic gating pipeline

### Added
- `lib/protoforge/` foundation: `policies` and `decisions` Supabase tables
- KILO→ProtoForge automatic gating pipeline — every KILO hypothesis now passes through PolicyEngine before reaching the Emission Layer
- ProtoForge calibration worker and migration (feedback loop layer 3)
- 29 unit tests for the DSL policy engine

### Fixed
- 10 bugs across Ursula heartbeat, SSE stream, and SSE manager

## [2026-05-27] — Ops substrate + security hardening

### Added
- Ops substrate: infrastructure health bridge, enforcement modules re-enabled
- HeidiCoreLoop unit test suite (35 tests)
- `selfHealing` and `redisStream` integrated into `HeidiCoreLoop.executeLoop()`
- Stripe Connect setup script

### Fixed
- RLS enabled on 4 previously unprotected public tables (Advisor CRITICAL)
- Resolved all 9 failing unit test cases
- Resolved postcss CVE GHSA-qx2v-qp2m-jg93 via dependency override
- Scoped Babel to Jest only; Next.js build now uses SWC

## [2026-05-19–21] — Phase 5: meta-cognition + local mobile chat

### Added
- Phase 5 autonomous reasoning queue wired to real HYDI infrastructure
- Phase 5 meta-cognition and knowledge synthesis engine
- Context feedback loop — synthesized insights injected into `/think` prompt
- Local mobile chat with streaming, TTS, voice input, and Ollama integration
- HYDI cognitive loop, governance gate, and automated deployment
- HEIDI diagnostic script and PM2 service setup

## [2026-05-16] — Phase 1+2: telemetry, self-healing, Redis, ProtoForge runtime

### Added
- Telemetry self-healing engine (`SelfHealingService`) and Redis stream broker for the core loop
- Replay history migration, traces API (`api/events/stream.js`), and trace viewer UI pages
- ProtoForge core runtime: task engine, message bus, memory, safety, observability modules
- Service-to-service HMAC auth on `api/chat` (#30)
- TermuxBridge JS client (`termuxClient`)
- `api/mobile-status.js` precursor: lazy env loading and unit tests for self-healing + Redis broker
- Registered Rezonate as HYDI federation node
- Heidi self-optimization: Vercel admin handler + TermuxBridge infra integration
- Deploy hook self-provisioning and end-to-end smoke test

## [2026-04-24] — Monetization deployment + initial foundation

### Added
- Complete HYDI monetization deployment: Stripe Connect sub-accounts for `galactic_bytes`, `detailer_bot`, `lipi_v2`, `protogrance_aromatics`, `rezonate`, `waveformer_studio`
- Adaptive feedback loop with working memory buffer
- Supabase migrations for core ledger, clients, payouts, and revenue pipeline tables
- Phase 1 repository: clean repo initialization with full file tracking
- `hdi-governance-gate.yml` CI workflow (7-gate schema review for migrations)
- `unit-tests.yml` CI workflow with Codecov integration

[Unreleased]: https://github.com/waveformer1984/HYDI-System-v2/compare/HEAD...HEAD
