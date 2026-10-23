# HEIDI Recovery Model

## Purpose

HEIDI performs only bounded, authorized, and verified recovery actions. Every recovery is recorded in the audit log and incident store.

## Recovery lifecycle

```
OBSERVE → CLASSIFY → AUTHORIZE → EXECUTE → VERIFY → RECORD
```

## Recovery capabilities

| Capability | Risk | Description | Verification |
|---|---|---|---|
| `health.read` | READ | Read health endpoints | — |
| `health.recover` | LOW | Restart an allowlisted safe container | HTTP/TCP health re-probe |
| `wsl_docker.local` | LOW | WSL `docker` container `status` / `restart_container` | `docker ps` + health endpoint |
| `wsl_compose.local` | LOW | WSL `docker compose` `status` / `restart` | `docker compose ps` + health endpoint |

## Prohibited actions

The following are forbidden unless explicitly approved through a separate process:

* `deploy.production`
* `credential.production`
* `financial.transaction`
* `database.destructive`
* Arbitrary container deletion
* Volume removal / `prune`
* Host network or firewall changes
* Credential changes

## Verification rules

1. After any restart, re-probe the health endpoint or TCP port.
2. Wait for a short stability window before declaring `RECOVERED`.
3. If verification fails, mark `RECOVERY_FAILED` and do not loop.
4. Respect cooldowns and retry limits.

## Executor implementation

* `src/heidi-executive/ControlledExecutor.js` — existing allowlist executor.
* `src/heidi-executive/WslExecutor.js` — WSL Docker/Compose bounded executor.
* `src/heidi-executive/HeidiExecutive.js` — orchestrates policy, execution, and audit.
