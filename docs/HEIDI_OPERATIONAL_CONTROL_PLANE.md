# Heidi Operational Control Plane v1

## Purpose

Transform Heidi from a local AI/runtime component into a bounded executive operator that can plan and execute authorized HYDI tasks on the user's behalf. The control plane is deterministic: every action is capability-registered, policy-checked, optionally approved, audited, and verified.

## Architecture

```
USER
 ↓
HEIDI EXECUTIVE AGENT  (src/heidi-executive/HeidiExecutive.js)
 ↓
MISSION / TASK PLANNER (src/heidi-executive/MissionPlanner.js)
 ↓
CAPABILITY REGISTRY    (src/heidi-executive/CapabilityRegistry.js)
 ↓
POLICY + PERMISSION    (src/heidi-executive/PolicyEngine.js)
 ↓
APPROVAL MANAGER       (src/heidi-executive/ApprovalManager.js)
 ↓
CONTROLLED EXECUTOR    (src/heidi-executive/ControlledExecutor.js)
 ↓
LOCAL / EXTERNAL SYSTEMS
```

Supporting subsystems:

- `TaskStateMachine` — prevents illegal state transitions.
- `SecretBroker` — resolves credential references; never exposes raw values.
- `AuditLog` — records every task, redacting inputs.
- `HealthAggregator` — collects local health state.
- `RecoveryEngine` — bounded retries for recoverable failures.
- `DryRunExecutor` — previews medium/high/critical actions.

## Key Constraints

- No action executes without a registered capability.
- No high-risk or critical action executes without approval.
- No model can approve its own critical actions.
- No raw credential reaches the reasoning layer, logs, or dashboard.
- Unknown health state is `UNKNOWN`, never `HEALTHY`.
- Local-first; cloud capabilities are optional.

## Quick Use

```js
const { HeidiExecutive } = require('./src/heidi-executive');
const heidi = new HeidiExecutive();

await heidi.run({ id: 't1', capabilityId: 'health.read' }, { id: 'owner' });
```

## Files

- `src/heidi-executive/index.js` — exports.
- `src/heidi-executive/HeidiExecutive.js` — executive orchestrator.
- `src/heidi-executive/CapabilityRegistry.js` — canonical registry.
- `src/heidi-executive/TaskStateMachine.js` — task states and transitions.
- `src/heidi-executive/PolicyEngine.js` — deterministic policy checks.
- `src/heidi-executive/ApprovalManager.js` — approval records.
- `src/heidi-executive/SecretBroker.js` — redaction and credential refs.
- `src/heidi-executive/AuditLog.js` — queryable task audit.
- `src/heidi-executive/ControlledExecutor.js` — bounded executors.
- `src/heidi-executive/HealthAggregator.js` — system health aggregation.
- `src/heidi-executive/MissionPlanner.js` — bounded task graphs.
- `src/heidi-executive/RecoveryEngine.js` — bounded recovery.
- `src/heidi-executive/DryRunExecutor.js` — dry-run previews.
- `tests/unit/heidi-executive/control-plane.test.js` — 26 unit tests.
- `dashboard/heidi-control-plane.html` — executive dashboard.

## Test Results

- `npm run typecheck` — PASS
- `npx jest tests/unit/heidi-executive/control-plane.test.js` — PASS (26/26)
- `npm test` — PASS
- `npm run build` — PASS
- `npm run hydi:readiness` — READY

## Remaining Work

- Wire real health checkers (Ollama, Docker, Supabase, etc.) into `HealthAggregator`.
- Add persistent storage for `AuditLog` and `ApprovalManager`.
- Implement live dashboard data polling.
- Extend `ControlledExecutor` with real executors for Docker/WSL/database.
- Acceptance mission "Make HYDI operational" end-to-end with a deliberately stopped safe local service.
