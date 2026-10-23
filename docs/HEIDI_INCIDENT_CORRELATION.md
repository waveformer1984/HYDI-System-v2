# HEIDI Incident Correlation

## Purpose

Prevent one root failure from spawning many independent incidents. HEIDI groups dependent symptoms under a root incident.

## Method

1. Identify infrastructure root failures (e.g., `docker-daemon`).
2. For each unhealthy non-infrastructure component, find whether it transitively depends on a root.
3. If yes, attach it as an affected symptom.
4. If no, create a standalone root incident.

## Output

```json
{
  "roots": [
    {
      "component": "docker-daemon",
      "failure_class": "DOCKER_RUNTIME_FAILURE",
      "affected": [
        { "component": "next-app", "state": "UNAVAILABLE" },
        { "component": "heidi-bridge", "state": "UNAVAILABLE" }
      ]
    }
  ],
  "symptoms": {
    "next-app": "docker-daemon",
    "heidi-bridge": "docker-daemon"
  }
}
```

## Benefits

- Operators see the real root cause.
- HEIDI does not waste time recovering each symptom independently.
- Recovery actions target the root, then verify dependents.
- Audit records reflect the actual dependency structure.
