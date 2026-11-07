# Health Contract (Phase 2)

Every HTTP service on Frank answers `GET /health`. PM2 "online" is process
liveness only — `/health` (or the service's status file) is the evidence.

## Response shape (target)

```json
{
  "service": "heidi-core",
  "version": "<git sha or package version>",
  "status": "ok | degraded | unavailable",
  "uptime_s": 1234,
  "deps": { "supabase": "ok", "ollama": "ok" }
}
```

Rules:

- `status` reflects real evidence, never "ok because the process is up".
- A dependency that cannot be reached is reported in `deps`, and `status`
  downgrades to `degraded`/`unavailable` accordingly.
- HTTP 200 means the handler ran; read `status` for semantics (same
  contract as `/api/health` on heidi-web — see
  `tests/unit/health-transport-contract.test.js`).

## Current coverage

| Service | Port | `/health` | Notes |
|---|---|---|---|
| heidi-web | 3000 | via rewrite → `/api/health` | payload includes daemon-verdict downgrade |
| heidi-core | 3459 | native `GET /health` | |
| heidi-mobile-chat | 3006 | `/health` + `/api/health` alias | deps: heidiCore, ollama, lmstudio |
| ursula-local | 3100 | Next app routes | per-page APIs; no single /health yet — gap |
| rezonate-app | 3001 | native `GET /health` | |
| protoforge-core | 3005 | `/health` (boot gate uses it) | boot-child, not PM2 |
| ollama | 11434 | `/api/tags` (Ollama native) | no /health — use tags |
| heidi-bridge | 5050 | `/health` | external `C:\ProtoForge_Ecosystem`, not running |
| PM2 loop workers (schedulers, observer, guard, deploy…) | — | n/a | health = PM2 status + `.runtime/*` status files (`frank-observer` writes `.observatory/current.json`, daemon writes `.heidi-daemon-status.json`) |

## Verifying

```powershell
scripts\frank\port-doctor.ps1            # who holds each registry port
node scripts\check-port-registry.js      # declared ports vs .ports.json
node scripts\check-ports.js              # are registry ports free (pre-start)
```
