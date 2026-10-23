# HEIDI Operational Policy

## Core Rule

No action may execute without passing:

```text
OBSERVATION → POLICY → AUTHORIZATION → CAPABILITY → EXECUTION
```

## Observation

- Health and runtime observations are append-only.
- Observations are redacted before storage.
- Observations never include raw credentials.

## Policy

- Capabilities are registered in `CapabilityRegistry`.
- Each capability has a `riskLevel`, `allowedTargets`, `requiredPermissions`, and `reversibility`.
- `AutonomyPolicy` maps each capability to an autonomy level.

## Authorization

- `L0–L4` may execute autonomously if policy allows.
- `L5` requires explicit human approval.
- `FORBIDDEN` never executes.
- Unknown capabilities are `FORBIDDEN`.

## Capability

- `ControlledExecutor` only performs allowlisted operations.
- No arbitrary shell or command execution.
- Target resources are bound to the capability registration.

## Execution

- `MissionEngine` enforces `maxActions`, `maxRetries`, `cooldownMs`, and `missionTimeoutMs`.
- Verification runs after execution.
- Failures stop the mission unless a bounded fallback is defined.

## Audit

- `DecisionRecord` stores every observation, candidate, decision, authorization, and result.
- `AuditLog` records task lifecycle events.
- A reviewer can answer `Why did HEIDI do that?` from evidence alone.

## Security Invariants

- LLM output cannot bypass policy.
- Missions cannot create or expand capabilities.
- Diagnostic data cannot expose secrets.
- Incident history cannot alter policy.
- External input cannot change autonomy levels.
