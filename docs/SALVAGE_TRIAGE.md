# SALVAGE TRIAGE — PR #415 (`salvage/hydi-system-executive-2026-10-23`)

The salvage branch carries the Phase-13 `src/heidi-executive/` "Operational
Control Plane v1" plus its `docs/HEIDI_*` design notes (~32 modules, ~3k
LoC) inside ~920 files of vendored code, generated reports, machine
artifacts, and the old repo's root files. This document is the per-file
verdict. Verdicts:

- **port** — functionality not present on `clean-main`; ported forward in a
  small PR against `clean-main` (adapted to `lib/human-actions` /
  `lib/runtime` APIs, with tests).
- **already exists as `<path>`** — equivalent-or-stronger code is already
  on `clean-main`; nothing to port.
- **drop** — dead by design: targets the retired compose/WSL runtime,
  duplicates a doc that exists newer, or is a machine/generated artifact.

Excluded up front per instructions: `vendor/` (esm.sh vendored deps),
`riq-evidence/`, `*.pcap`, `*.log`, `node_modules` d.ts trees, old repo
reports (`*_Report.md`, `HYDI_PHASE*.md`, `RC*`), and root-dotfiles —
none are ported.

## src/heidi-executive/ — control-plane modules

| File | Verdict | Reason |
|---|---|---|
| `HeidiExecutive.js` | already exists as `lib/heidi/AgentControlPlane.ts` + `lib/human-actions/service.js` | task lifecycle (PROPOSED→VALIDATING→APPROVAL→EXECUTING→VERIFYING→COMPLETED) is now the durable action lifecycle + mission runner |
| `TaskStateMachine.js` | already exists as `lib/operational/StateMachine.ts` + `lib/heidi/MissionLifecycle.ts` | transition graph exists richer |
| `CapabilityRegistry.js` | already exists as `lib/operational/ActionRegistry.ts` + `src/hydi-v3/CapabilityRegistry.js` | registry + risk levels exist |
| `PolicyEngine.js` | already exists as `lib/human-actions/resolver-policy.js` + `lib/protoforge/policy-engine.js` | fail-closed policy evaluation exists |
| `AutonomyPolicy.js` | already exists as `lib/operational/AutonomyPolicyModel.ts` + `lib/human-actions/boundary.js` (R0–R4) | R0–R4 class model is strictly richer than L0–L5 |
| `ApprovalManager.js` | already exists as `src/hydi-v3/ApprovalCenter.js` + `lib/human-actions` store | durable approvals + self-approval prohibition exist |
| `SecretBroker.js` | already exists as `lib/operational/SecretManager.ts` + `KeyVaults.ts` + `SecretScanner.ts` | reference-resolution + redaction exist; JWT/key redaction is in the mirror/store paths |
| `AuditLog.js` | already exists as `src/hydi-v3/AuditLedger.js` + `lib/operational/KeyAuditService.ts` + `PolicyDecisionRecord.ts` | hashed/append-only audit exists |
| `ControlledExecutor.js` | already exists as `lib/human-action/adapters/InfrastructureAdapter.ts` + `lib/operational/CapabilityAuthorizer.ts` | allowlisted exec with hard-deny capabilities exists |
| `DryRunExecutor.js` | already exists as `deps.dryRun` seam in `lib/human-actions/resolvers.js` + shadow-mode runs | preview-without-execute is a resolver seam |
| `HealthAggregator.js` | already exists as `lib/operational/SelfHealthMonitor.ts` + `src/hydi-v3/HealthSupervisor.js` | named-checker registry + summary exists |
| `LocalHealthProbes.js` | already exists as `lib/operational/EndpointHealthContract.ts` + `lib/runtime/collect.js` | bounded local probes exist (PM2/HTTP) |
| `LocalRecoveryWorkflow.js` | already exists as `lib/operational/DependencyAwareRestartExecutor.ts` + runtime reconcile | probe → bounded restart → re-probe exists |
| `MissionPlanner.js` | already exists as `src/hydi-v3/MissionPlanner.js` + `lib/heidi/Planner.ts` | goal→task-graph planning exists |
| `RecoveryEngine.js` | already exists as `lib/operational/RecoveryEngine.ts` + `RecoveryStrategyModel.ts` + `src/hydi-v3/RecoveryCoordinator.js` | bounded retries/backoff exist |
| `HeidiDecisionEngine.js` | already exists as `lib/heidi/CognitiveCore.ts` + `AgentControlPlane.ts` | observe→decide→escalate pipeline exists |
| `OperationalLoop.js` | already exists as `lib/heidi/AgentControlPlane.ts` + hydi-daemon | bounded cycle loop exists |
| `OperationalState.js` | already exists as `lib/operational/SystemStateModel.ts` | STABLE/INCIDENT/RECOVERY states exist |
| `DecisionRecord.js` | already exists as `src/hydi-v3/DecisionJournal.js` + `lib/operational/PolicyDecisionRecord.ts` | durable decision records exist |
| `IncidentCorrelator.js` | already exists as `lib/operational/IncidentCorrelator.ts` + `DependencyGraphBuilder.ts` | dependency-graph root-cause grouping exists |
| `ImpactAssessor.js` | already exists as `lib/operational/RiskClassifier.ts` + `EvidenceModel.ts` | blast-radius/criticality scoring exists |
| `ActionSelector.js` | already exists as `lib/operational/ActionSelector.ts` | history+risk scored selection exists |
| `MissionEngine.js` | already exists as `lib/heidi/MissionRunner.ts` + `MissionLedger.ts` | bounded step execution + evidence exists |
| `FailureClassifier.js` | already exists as `src/hydi-v3/FailureTaxonomy.js` + `lib/operational/RecoveryOutcomeClassifier.ts` | pattern-based failure classes exist |
| `IncidentStore.js` | already exists as `lib/operational/OperationalMemoryStore.ts` + `human_action_mirror` + `heidi_events` | durable JSONL operational records exist |
| `DiagnosticCommand.js` | already exists as `scripts/hydi-diagnose.js` + `lib/operational/OperationalIntelligence.ts` + `OperatorView.ts` | read-only status report exists |
| `MaintenanceMode.js` | **port** | per-component suppression windows (stop auto-recovery while an operator is maintaining a component) — no equivalent in resolver path |
| `PredictiveIntelligence.js` | drop | restart-spike/latency-regression heuristic; restart counts are already surfaced by the PM2 audit + docker collection, `ForecastEngine.js` covers forecasting — no standalone port |
| `RuntimeObserver.js` | **port** (docker/container subset) | docker container-state probes cover live supabase/ursula containers that the PM2-only audit misses; WSL/compose-service probes dropped (WSL is not the runtime) |
| `RuntimeObservationAdapter.js` | drop | normalizes RuntimeObserver output for the retired decision engine — `lib/runtime/collect.js` + `DependencyGraphBuilder.ts` supersede it |
| `WslExecutor.js` | **port** (restart allowlist pattern) | bounded `docker restart`/compose ops for declared containers; ported as `docker-restart` resolver + `docker-container-running` verifier — WSL routing dropped |
| `index.js` | drop | v1 barrel file |

## docs/HEIDI_* — design notes

All 18 documents specify the retired `src/heidi-executive` module names and
the compose/WSL topology; `clean-main` has newer equivalents for every
concept. None are ported as files.

| File | Verdict | Reason |
|---|---|---|
| `HEIDI_APPROVAL_MODEL.md` | already exists as `docs/HYDI_AUTONOMY_BOUNDARIES.md` + ApprovalCenter/human-action design | approval semantics covered |
| `HEIDI_AUTONOMY_BOUNDARIES.md` / `HEIDI_AUTONOMY_BOUNDARY.md` / `HEIDI_AUTONOMY_LEVELS.md` | already exists as `docs/HYDI_AUTONOMY_BOUNDARIES.md` + `HEIDI_APEX_AUTONOMY_BOUNDARY.md` + R0–R4 classes | superseded by newer boundary docs |
| `HEIDI_CAPABILITY_MATRIX.md` | already exists as `docs/PLATFORM_CAPABILITY_REGISTRY.md` + `HYDI_SYSTEM_CAPABILITY_MATRIX.md` | capability tables exist |
| `HEIDI_DECISION_ENGINE.md` | already exists as `lib/heidi` CognitiveCore docs/`BOUNDED_COGNITIVE_LOOP.md` | decision pipeline documented |
| `HEIDI_DOCKER_FORENSICS.md` | **port** (as evidence checklist) | capture-first forensics list folded into the ported docker ops (detector instructions + `lib/runtime/docker.js`) |
| `HEIDI_EXECUTION_AUDIT.md` | already exists as AuditLedger/KeyAuditService + `PolicyDecisionRecord` | audit model covered |
| `HEIDI_FAILURE_TAXONOMY.md` | already exists as `src/hydi-v3/FailureTaxonomy.js` | taxonomy exists |
| `HEIDI_INCIDENT_CORRELATION.md` | already exists as `lib/operational/IncidentCorrelator.ts` | correlation covered |
| `HEIDI_LOCAL_OPERATIONAL_AUTHORITY.md` | already exists as `HEIDI_OPERATIONAL_AUTHORITY_MATRIX.md` | authority model covered |
| `HEIDI_MISSION_MODEL.md` | already exists as `lib/heidi/MissionLifecycle.ts` | mission model covered |
| `HEIDI_OPERATIONAL_CONTROL_PLANE.md` | already exists as `lib/operational/ProductionOperationsControlPlane.ts` | control plane documented |
| `HEIDI_OPERATIONAL_INTELLIGENCE.md` | already exists as `lib/operational/OperationalIntelligence.ts` + `scripts/hydi-diagnose.js` | inventory/diagnostic doc covered |
| `HEIDI_OPERATIONAL_POLICY.md` | already exists as `lib/human-actions/resolver-policy.js` | policy model covered |
| `HEIDI_OPERATIONAL_READINESS.md` | drop | v1 phase-readiness report, not a reusable spec |
| `HEIDI_PERMISSION_MODEL.md` | already exists as `AuthorityBounds.js` + `AutonomyContract.ts` | permission model covered |
| `HEIDI_RECOVERY_MODEL.md` | already exists as `RecoveryEngine.ts` + `RecoveryStrategyModel.ts` | recovery model covered |

## Port groups

1. **Docker ops** (`feat/salvage-docker-ops`): `lib/runtime/docker.js`
   (container-state collection, honest NOT_CONFIGURED/UNAVAILABLE),
   `detectDockerContainers` pass in `lib/human-actions/detector.js`,
   `docker:container-*` prefix policy (R1), `docker-restart` resolver
   (HYDI_DOCKER_RESTART_ALLOW allowlist, fail-closed), and
   `docker-container-running` verifier. Ports the RuntimeObserver docker
   probes + WslExecutor bounded-restart pattern + the forensics evidence
   checklist. `INFRASTRUCTURE` added to the boundary vocabulary.
2. **Maintenance windows** (`feat/salvage-maintenance-windows`):
   `MaintenanceMode` ported as a durable per-component suppression check —
   resolver attempts defer while a component is under declared
   maintenance, so operator maintenance is never fought by auto-recovery.
