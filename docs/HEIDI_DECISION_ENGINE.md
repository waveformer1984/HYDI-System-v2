# HEIDI Decision Engine

## Purpose

The HEIDI Decision Engine is a bounded, deterministic, auditable operational decision layer. It extends the existing `src/heidi-executive/` control plane from `OBSERVE → CLASSIFY → RECOVER` to the full loop:

```
OBSERVE
   ↓
UNDERSTAND
   ↓
CORRELATE
   ↓
ASSESS IMPACT
   ↓
SELECT ACTION
   ↓
AUTHORIZE
   ↓
EXECUTE
   ↓
VERIFY
   ↓
LEARN
```

The engine is **not** an unrestricted autonomous agent. Every decision must pass `POLICY → AUTHORIZATION → CAPABILITY → EXECUTION`, and every decision is recorded.

## Components

### OperationalState

`src/heidi-executive/OperationalState.js`

Explicit, bounded operational states:

- `UNKNOWN`, `STABLE`, `DEGRADED`, `INCIDENT`, `RECOVERING`, `RECOVERED`, `RECOVERY_FAILED`, `MAINTENANCE`

Every transition is timestamped, sourced, and reasoned. Invalid transitions are rejected.

### IncidentCorrelator

`src/heidi-executive/IncidentCorrelator.js`

Correlates failures against the service dependency graph and produces:

- One root incident per root cause
- Affected dependents linked to that root
- Symptoms mapped to roots

This prevents the creation of one isolated incident per downstream symptom.

### ImpactAssessor

`src/heidi-executive/ImpactAssessor.js`

Deterministic impact model:

- `NONE`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`

Factors: critical component, dependents, data integrity, user-facing impact, duration.

### ActionSelector

`src/heidi-executive/ActionSelector.js`

Deterministic action scoring based on:

- historical success rate
- risk level
- reversibility
- dependency readiness
- cooldown
- recent failures
- maintenance state
- blast radius

No LLM is used for selection.

### AutonomyPolicy

`src/heidi-executive/AutonomyPolicy.js`

Maps capabilities to autonomy levels:

- `L0_OBSERVE`
- `L1_DIAGNOSE`
- `L2_RECOMMEND`
- `L3_AUTO_RECOVER`
- `L4_MULTI_STEP_RECOVERY`
- `L5_HUMAN_APPROVAL`
- `FORBIDDEN`

Unknown capabilities default to `FORBIDDEN`.

### MissionEngine

`src/heidi-executive/MissionEngine.js`

Bounded mission execution:

- `PLAN → AUTHORIZE → EXECUTE → VERIFY → COMPLETE`

Limits: `maxActions`, `maxRetries`, `missionTimeoutMs`, cooldown between actions, bounded fallbacks.

### DecisionRecord

`src/heidi-executive/DecisionRecord.js`

Immutable decision record:

```text
decision_id
mission_id
incident_id
observations
classification
impact
candidate_actions
selected_action
policy_result
authorization_result
execution_result
verification_result
confidence
final_state
```

### PredictiveIntelligence

`src/heidi-executive/PredictiveIntelligence.js`

Detects leading indicators:

- restart spikes
- recovery latency regression

Produces warnings, not actions.

### MaintenanceMode

`src/heidi-executive/MaintenanceMode.js`

Suppresses expected incidents during scheduled maintenance. Maintenance has scope, start time, expected duration, source, and reason. Expired windows are automatically removed.

### HeidiDecisionEngine

`src/heidi-executive/HeidiDecisionEngine.js`

Composes the above into a single `decide(observations, candidates, options)` call. It returns:

- current operational state
- correlated root incidents
- per-root decision records
- active maintenance
- escalations

## Security

- Unknown capabilities are forbidden.
- LLM or external recommendations cannot bypass policy.
- Diagnostic data is redacted before recording.
- Missions cannot expand their own permissions.
- Missions cannot create new capabilities.
- Missions cannot execute arbitrary shell.
- Forbidden actions remain forbidden.
- Incident history cannot modify policy.
