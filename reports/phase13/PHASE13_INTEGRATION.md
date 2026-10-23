# Phase 13 — Operational Integration

## Architecture

The live integration is wired through the existing `HeidiExecutive` as the single control plane.

```
RuntimeObserver
      ↓
RuntimeObservationAdapter
      ↓
HeidiExecutive.operationalCycle()
      ↓
HeidiDecisionEngine
      ↓
PolicyEngine / AutonomyPolicy
      ↓
ControlledExecutor
      ↓
RuntimeObserver (verification)
      ↓
IncidentStore / DecisionRecord / AuditLog
```

## Components Added

- `src/heidi-executive/RuntimeObservationAdapter.js`
- `src/heidi-executive/OperationalLoop.js`
- `scripts/phase13-qual.js`

## Components Updated

- `src/heidi-executive/HeidiExecutive.js` — owns `operationalCycle`, observation, decision, execution, and verification.
- `src/heidi-executive/HeidiDecisionEngine.js` — returns `selected_action` with `capabilityId` and `parameters` for the capability layer.
- `src/heidi-executive/ActionSelector.js` — exposes `capabilityId`/`parameters`.
- `src/heidi-executive/ControlledExecutor.js` — added `compose_restart` for Ursula Postgres/Redis/ProtoHub.
- `src/heidi-executive/index.js` — exports new components.

## Modes

- `DECISION_ONLY` — observe, decide, authorize, record; never execute.
- `SHADOW` — same while the real system keeps running.
- `CONTROLLED` — executes low-risk `docker.local` compose restarts through `HeidiExecutive`.

## Observation Provenance

Every observation comes from `RuntimeObserver`. `RuntimeObservationAdapter` only normalizes the schema and adds `dependencyGraph` from `services-manifest.json` and `PredictiveIntelligence` warnings. It does not run its own probes.
