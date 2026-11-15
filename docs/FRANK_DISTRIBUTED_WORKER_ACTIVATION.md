# Frank home worker activation (operator)

**Status:** CONFIGURED BUT UNTESTED on Frank — agent cannot reach Frank from cloud VM.

## Prerequisites

- Canonical repo on Frank at `clean-main` (or branch containing PR #590).
- `HYDI_DISTRIBUTED_WORKER_SECRET` set in PM2 env or user scope (same value as coordinator).
- Coordinator durability: either
  - **A)** Shared `.runtime/distributed-cloud/` via same machine (Frank is coordinator + worker), or
  - **B)** Tailscale serve `scripts/distributed-cloud-serve.js` on `127.0.0.1:3471` (tailnet only), or
  - **C)** Cloud agent holds queue; Frank pulls via HTTPS with token (**REQUIRES_OPERATOR_APPROVAL** for URL exposure).

## Diagnostic smoke (harmless)

```powershell
cd C:\Users\Owner\HYDI-System-v2
$env:HYDI_DISTRIBUTED_WORKER_SECRET = "<match-coordinator>"
$env:FRANK_WORKER = "1"
$env:HYDI_REPO_ROOT = (Get-Location).Path
node scripts/distributed-live-smoke.js
```

Expected: exit 0, `classification: VERIFIED_LIVE`, evidence under `.runtime/distributed-cloud/evidence/`.

## Worker loop (future)

Use pull model only — no inbound ports. Schedule via Task Scheduler or PM2 cron calling a thin script that: register → heartbeat → `claimNext` → run allowlisted diagnostic → `completeTask`.

## Do not

- Expose Ollama (`11434`) or Postgres to the internet.
- Set `REVENUE_OPS_ALLOW_SUBMIT` or `HEIDI_ALLOW_EXEC` for validation smoke.