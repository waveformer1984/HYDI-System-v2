# HYDI Production Readiness Checklist

Phase 23 operational proof-of-life. Each item references the module, function, or test that proves the capability. A `[ ]` box is left for the final human sign-off; the evidence is recorded in the adjacent reference.

## BOOT

- [ ] **repository identity verified** — `HYDIOperationalBoot.boot()` enforces Node `>=20` and resolves `dataPath` before any component is constructed.  
  Evidence: `src/hydi-v3/HYDIOperationalBoot.js`, `src/hydi-v3/HYDIStartupSequence.js` `validateEnvironment()` / `validateConfig()`.

- [ ] **configuration loaded** — `HYDIStartupSequence.validateConfig()` resolves and validates `dataPath`, and `OperatorSession` receives the resolved path.  
  Evidence: `src/hydi-v3/HYDIStartupSequence.js`, `src/hydi-v3/OperatorSession.js` constructor.

- [ ] **OperatorSession starts** — `OperatorSession.start()` constructs and starts all executive components in dependency order.  
  Evidence: `src/hydi-v3/OperatorSession.js` lines 123-364.

- [ ] **event bus active** — `BusinessEventBus` is constructed in `OperatorSession`, and `healthCheck()` verifies `eventBus` presence.  
  Evidence: `src/hydi-v3/BusinessEventBus.js`, `src/hydi-v3/OperatorSession.js` lines 79, 414-415.

- [ ] **sensors registered** — `OperatorSession` conditionally attaches `GitSensor`, `PrinterSensor`, `RevenueSensor`, and `FilesystemMonitor` into `this.sensors`.  
  Evidence: `src/hydi-v3/OperatorSession.js` lines 298-337, `src/hydi-v3/GitSensor.js`, `src/hydi-v3/PrinterSensor.js`, `src/hydi-v3/RevenueSensor.js`, `src/hydi-v3/FilesystemMonitor.js`.

- [ ] **interpreters registered** — `BusinessSignalInterpreter` and `ManufacturingSignalInterpreter` attach to the bus before any sensor can emit.  
  Evidence: `src/hydi-v3/OperatorSession.js` lines 294-296, `src/hydi-v3/BusinessSignalInterpreter.js`, `src/hydi-v3/ManufacturingSignalInterpreter.js`.

- [ ] **signal coverage verified** — `SignalCoverage.audit({ registry: session.eventBus.registry })` is called at startup and `HYDIStartupSequence.generateHealthReport()` surfaces dropped, double, orphan, and unknown event types.  
  Evidence: `src/hydi-v3/SignalCoverage.js`, `src/hydi-v3/HYDIStartupSequence.js`, `src/hydi-v3/OperatorSession.js` lines 343-349.

- [ ] **memory available** — `BusinessMemory.start()` loads or initializes the entity graph, and `OperatorSession.healthCheck()` checks `memory`.  
  Evidence: `src/hydi-v3/BusinessMemory.js`, `src/hydi-v3/OperatorSession.js` lines 178-180, 399.

- [ ] **audit ledger available** — `AuditLedger.start()` loads the chain and `verify()` is exercised at boot by `HYDIStartupSequence.generateHealthReport()`.  
  Evidence: `src/hydi-v3/AuditLedger.js`, `src/hydi-v3/HYDIStartupSequence.js` `generateHealthReport()`.

- [ ] **trust engine available** — `ExecutiveOperatingSystem` constructs `TrustEngine`, and `TrustEngine.computeConfidence()` / `generateProvenance()` are exercised for every recommendation.  
  Evidence: `src/hydi-v3/ExecutiveOperatingSystem.js` constructor, `src/hydi-v3/TrustEngine.js`.

- [ ] **learning system available** — `BusinessOutcomeEngine`, `LearningMetrics`, `RecommendationTracker`, and `DecisionOutcomeStore` start before `ExecutiveOperatingSystem`, and `healthCheck()` verifies `learningMetrics`.  
  Evidence: `src/hydi-v3/OperatorSession.js` lines 131-172, `src/hydi-v3/LearningMetrics.js`, `src/hydi-v3/BusinessOutcomeEngine.js`, `src/hydi-v3/RecommendationTracker.js`, `src/hydi-v3/DecisionOutcomeStore.js`.

## SENSORS

- [ ] **filesystem sensor** — `FilesystemMonitor` emits `FileCreated`/`FileModified`/... events, which `BusinessSignalInterpreter` routes to the correct strategic objective and subsystem.  
  Evidence: `src/hydi-v3/FilesystemMonitor.js`, `src/hydi-v3/BusinessSignalInterpreter.js` `handledEventTypes`, `detectFileCategory()`, `detectSubsystem()`.

- [ ] **git sensor** — `GitSensor` emits `CommitCreated` and related events; `scripts/operator-cli.js` exposes `--git` to attach it.  
  Evidence: `src/hydi-v3/GitSensor.js`, `scripts/operator-cli.js` `gitConfig()`.

- [ ] **manufacturing/printer sensor** — `PrinterSensor` emits `PrinterOffline`/`PrinterFailed`/`PrinterCompleted` events; `ManufacturingSignalInterpreter` translates them into risk-scored `BusinessSignal`s.  
  Evidence: `src/hydi-v3/PrinterSensor.js`, `src/hydi-v3/ManufacturingSignalInterpreter.js` lines 64-121.

- [ ] **revenue sensor** — `RevenueSensor` with `JSONLedgerAdapter` / `CSVLedgerAdapter` emits `RevenueReceived`, `InvoicePaid`, etc.; `BusinessSignalInterpreter._interpretRevenue()` attaches financial evidence.  
  Evidence: `src/hydi-v3/RevenueSensor.js`, `src/hydi-v3/BusinessSignalInterpreter.js` `_interpretRevenue()`.

- [ ] **evidence providers** — `EvidenceProviders.registerDefaults()` registers `git`, `filesystem`, `manufacturing`, `financial`, and generic extractors consumed by `BusinessEvidenceEngine`.  
  Evidence: `src/hydi-v3/EvidenceProviders.js`, `src/hydi-v3/BusinessEvidenceEngine.js` constructor and `addEvidence()`.

## DECISION LOOP

- [ ] **signal received** — `BusinessEventBus.emit()` and `subscribe()` deliver typed events to interpreters; `getHistory()` supports replay.  
  Evidence: `src/hydi-v3/BusinessEventBus.js` lines 44-117.

- [ ] **business meaning interpreted** — `BusinessSignalInterpreter.interpret()` and `ManufacturingSignalInterpreter.interpret()` turn raw sensor events into `BusinessSignal` objects carrying `strategicObjective`, `subsystem`, `impact`, and `interpretation`.  
  Evidence: `src/hydi-v3/BusinessSignalInterpreter.js` `interpret()`, `src/hydi-v3/ManufacturingSignalInterpreter.js` `interpret()`.

- [ ] **recommendation generated** — `ExecutiveOperatingSystem.recommendations()` builds ranked recommendations from `priorityActions`, `risks`, and agent reports.  
  Evidence: `src/hydi-v3/ExecutiveOperatingSystem.js` lines 538-614.

- [ ] **confidence calculated** — `TrustEngine.computeConfidence()` and `generateProvenance()` compute a 0-1 confidence score for each recommendation; `_trackRecommendations()` attaches the score.  
  Evidence: `src/hydi-v3/TrustEngine.js` lines 28-88, `src/hydi-v3/ExecutiveOperatingSystem.js` lines 611-614, 642-655.

- [ ] **provenance attached** — `TrustEngine.generateProvenance()` returns `sources`, `assumptions`, `reasoning`, and `confidence`.  
  Evidence: `src/hydi-v3/TrustEngine.js` lines 46-88.

- [ ] **human approval possible** — `ExecutionGateway` classifies each action type and holds `review-required` actions in `pending` until `approve()` or `reject()` is called.  
  Evidence: `src/hydi-v3/ExecutionGateway.js` `execute()` / `approve()` / `reject()`.

- [ ] **execution guarded** — `ExecutionGateway._runEntry()` runs the adapter; `OperatorMode.install()` wraps `execute`, `approve`, `reject`, `BusinessWorkflowEngine.approveWorkflow`/`rejectWorkflow`, and `ConsoleAPI.backup` for `--dry-run` and `--offline`.  
  Evidence: `src/hydi-v3/ExecutionGateway.js` `_runEntry()`, `src/hydi-v3/OperatorMode.js`.

- [ ] **audit written** — `AuditLedger.record()` appends every `ExecutionGateway` action, every unknown `BusinessEventBus` event, and every startup report in a hash chain.  
  Evidence: `src/hydi-v3/AuditLedger.js` `record()` / `verify()`, `src/hydi-v3/ExecutionGateway.js` `_recordAudit()`, `src/hydi-v3/BusinessEventBus.js` lines 61-68.

- [ ] **evidence collected** — `EvidenceCollector` and `BusinessEvidenceEngine.addEvidence()` gather evidence per `recommendationId`; `BusinessEvidenceEngine.evaluateRecommendation()` closes the loop only when quality is sufficient.  
  Evidence: `src/hydi-v3/BusinessEvidenceEngine.js` `addEvidence()`, `evaluateRecommendation()`, `src/hydi-v3/EvidenceCollector.js`.

- [ ] **learning updated only from measured outcomes** — `BusinessOutcomeEngine.recordOutcome()` records a `measured` flag; `BusinessEvidenceEngine.getMeasuredLearningDashboard()` and `LearningMetrics.computeMetrics()` count only measured/quantitative outcomes. Simulated completions do not move confidence.  
  Evidence: `src/hydi-v3/BusinessOutcomeEngine.js` `recordOutcome()` / `observeAction()`, `src/hydi-v3/BusinessEvidenceEngine.js` `getMeasuredLearningDashboard()`, `src/hydi-v3/LearningMetrics.js` `computeMetrics()`.

## FAILURE SAFETY

- [ ] **dry-run cannot mutate state** — `ExecutionGateway.execute(action, { simulate: true })` calls `adapter.simulate()`; `BusinessOutcomeEngine.observeAction()` skips learning from simulated completions.  
  Evidence: `src/hydi-v3/ExecutionGateway.js` `execute()` / `approve()` simulate paths, `src/hydi-v3/BusinessOutcomeEngine.js` `observeAction()`, `tests/integration/hydi-production-failure-modes.test.js` dry-run test.

- [ ] **unknown events cannot disappear silently** — `BusinessEventBus.emit()` records unregistered event types in `AuditLedger` and `SignalCoverage.audit()` surfaces them in `unknown`.  
  Evidence: `src/hydi-v3/BusinessEventBus.js` lines 56-68, `src/hydi-v3/SignalCoverage.js` `audit()`, `tests/integration/hydi-production-failure-modes.test.js` unknown-event test.

- [ ] **corrupt persistence handled** — `BusinessMemory._load()` and `ExecutiveOperatingSystem._load()` archive corrupt JSON and restart from empty state rather than crash.  
  Evidence: `src/hydi-v3/BusinessMemory.js` `_load()` / `_archiveCorruptStore()`, `src/hydi-v3/ExecutiveOperatingSystem.js` `_load()` / `_archiveCorruptStore()` lines 695-724, `tests/integration/hydi-production-failure-modes.test.js` corrupt-memory test.

- [ ] **missing integrations degrade gracefully** — `OperatorSession.healthCheck()` remains `ok` with zero sensors; startup continues when optional sensors are not configured.  
  Evidence: `src/hydi-v3/OperatorSession.js` lines 421-425, `tests/integration/hydi-production-failure-modes.test.js` missing-sensor test.

- [ ] **shutdown drains safely** — `OperatorSession.destroy()` calls `_components()` in reverse dependency order, flushes each store, and stops sensors before interpreters. `GracefulShutdown` catches `SIGTERM`/`SIGINT` in `scripts/operator-cli.js`.  
  Evidence: `src/hydi-v3/OperatorSession.js` `destroy()` / `_components()`, `src/hydi-v3/GracefulShutdown.js`, `scripts/operator-cli.js`.
