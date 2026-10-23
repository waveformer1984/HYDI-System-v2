# HEIDI Mission Model

## Purpose

A mission is a bounded, auditable, and deterministic operational plan. It contains:

```text
mission_id
objective
scope
constraints
allowed_capabilities
forbidden_capabilities
deadline
risk_limit
success_conditions
rollback_conditions
```

Missions are the only path through which the decision engine may execute multiple recovery steps.

## Lifecycle

```
PLAN
  ↓
AUTHORIZE
  ↓
EXECUTE
  ↓
VERIFY
  ↓
COMPLETE or ROLLBACK
```

## Safety Boundaries

- `maxActions` prevents infinite loops.
- `maxRetries` limits repeated attempts.
- `cooldownMs` prevents action storms.
- `missionTimeoutMs` enforces a deadline.
- Fallback steps must be declared in the plan; the engine does not improvise.
- Forbidden capabilities cannot be added mid-mission.

## Example

```json
{
  "id": "mission-123",
  "objective": "Restore ProtoHub",
  "scope": ["protohub-api"],
  "allowed_capabilities": ["docker.local", "health.read"],
  "forbidden_capabilities": ["database.destructive", "volume.delete"],
  "deadline": 180000,
  "risk_limit": "MEDIUM",
  "success_conditions": ["http://localhost:4000/health returns 200 for 60s"],
  "rollback_conditions": ["three recovery attempts unsuccessful"]
}
```

## Deterministic Qualification Scenarios

- ProtoHub failure → detect → classify → assess → restart → verify → record
- Redis failure → detect → classify → recover → verify
- Multiple dependent failures → correlate → identify root → recover root → verify dependents
- Repeated recovery failure → stop → escalate
- Maintenance → suppress expected incident → expire → resume monitoring
