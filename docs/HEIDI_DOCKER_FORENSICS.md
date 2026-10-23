# HEIDI Docker Forensics

## Purpose

When Docker or the WSL runtime becomes unavailable, HEIDI captures everything it can observe before, during, and after recovery. The objective is not just to restart Docker; it is to understand what failed and why.

## Captured evidence

For every Docker/WSL incident, HEIDI records:

| Evidence | Source |
|---|---|
| Timestamp | `Date.now()` / ISO-8601 |
| WSL availability | `wsl -d Ubuntu -e echo wsl-ready` |
| Docker daemon version | `wsl -d Ubuntu -e docker version` |
| Container states | `wsl -d Ubuntu -e docker ps --all` |
| Container restart counts | `docker ps` / `docker inspect` `{{.RestartCount}}` |
| Compose service states | `docker compose ps -q <service>` |
| Resource pressure | `df -h /`, `free -m`, `/proc/loadavg` inside WSL |
| Affected ports | TCP probes to `54321`, `54322`, `5432`, `6379`, `4000`, `5050`, `3000`, `9997`, `9998` |
| Health endpoint latencies | HTTP probes from `RuntimeObserver` |
| Recovery attempts | `AuditLog` entries for `wsl_docker.local` / `wsl_compose.local` |
| Recovery duration | `AuditLog` timestamps |

## Forensic workflow

```
Docker/WSL symptom detected
      ↓
Capture snapshot (RuntimeObserver)
      ↓
Classify failure (FailureClassifier)
      ↓
If safe → attempt bounded recovery (WslExecutor)
      ↓
Re-capture snapshot
      ↓
Verify recovery (health re-probe)
      ↓
Append to IncidentStore
      ↓
If still failed → escalate and stop
```

## Example incident record

```json
{
  "incident_id": "inc-1234",
  "timestamp": "2026-08-16T09:30:00.000Z",
  "component": "docker-daemon",
  "failure_class": "DOCKER_RUNTIME_FAILURE",
  "symptoms": { "status": "UNAVAILABLE", "detail": "Cannot connect to the docker daemon" },
  "environment": { "wsl": "HEALTHY", "platform": "win32" },
  "dependency_state": { "postgres": "UNKNOWN", "redis": "UNKNOWN" },
  "diagnosis": { "cause": "DOCKER_RUNTIME_FAILURE", "confidence": "MEDIUM" },
  "action": { "capability": "wsl_docker.local", "operation": "status" },
  "result": { "success": false },
  "final_state": "RECOVERY_FAILED",
  "evidence_paths": ["~/.hydi/incidents/"]
}
```

## Source

Implemented in `src/heidi-executive/RuntimeObserver.js`, `IncidentStore.js`, and `FailureClassifier.js`.
