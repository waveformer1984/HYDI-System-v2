# HYDI Phase 10 — Runtime Network Capture Report

## Objective

Run the HYDI stack in a clean local environment, capture all network traffic during startup and a full agent-pipeline run, and prove that no outbound traffic is generated to hosted SaaS endpoints.

## Attempted Steps

1. **Verify local services**
   - Ollama: `curl http://localhost:11434/api/tags` — healthy, models present.
   - Docker/Supabase: `docker ps` and `supabase status` both failed because the Docker Desktop daemon is not running.
   - Local Supabase: `curl http://127.0.0.1:54321/health` — unreachable (Supabase not started).

2. **Packet-capture tooling**
   - `netsh trace start capture=yes tracefile=...` — blocked; requires Administrator elevation.
   - No `tcpdump`, `tshark`, `Npcap`, or `RawCap` detected on this Windows host.

## Blockers

- **Docker daemon not running** — `supabase start` cannot be executed, so the local Postgres/PostgREST/GoTrue/Realtime stack is unavailable. A full runtime boot of the six-agent pipeline cannot proceed without it.
- **Network trace requires admin** — `netsh trace` and `pktmon` both require elevated privileges on Windows. The current session cannot start a packet capture.

## Evidence Available

- `npm run typecheck`: pass
- `npm test`: 253/253 suites passed, 2449/2450 tests passed, 1 skipped, 0 failed
- Deno Edge Function dependencies are now vendored (`vendor/`) and `deno check supabase/functions/action-worker/index.ts` resolved remote imports from the local cache without new downloads.

## Recommended Procedure (requires Docker + admin)

```powershell
# 1. Start local Supabase (requires Docker Desktop running)
supabase start

# 2. Start an elevated netsh packet capture
netsh trace start capture=yes tracefile= C:\Users\Owner\HYDI_System\artifacts\hydi-network-capture.etl maxsize=512 overwrite=yes

# 3. In a new terminal, run HYDI with all cloud credentials unset
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_...'
$env:STRIPE_MODE = 'mock'
$env:OPENAI_API_KEY = ''
$env:ANTHROPIC_API_KEY = ''
$env:RESEND_API_KEY = ''
npm run dev

# 4. Wait for startup, then exercise the full pipeline
Start-Sleep -Seconds 20
curl -N -X POST http://localhost:3000/api/chat `n  -H "Content-Type: application/json" `n  -d '{"message":"status","system":"heidi"}'
curl -N -X POST http://localhost:3000/api/ursula/status

curl -N http://localhost:3000/api/health

# 5. Stop capture
netsh trace stop

# 6. Convert ETL to text and scan for forbidden hosts
netsh trace convert input= C:\Users\Owner\HYDI_System\artifacts\hydi-network-capture.etl output= C:\Users\Owner\HYDI_System\artifacts\hydi-network-capture.txt dump=txt
Select-String -Pattern 'akbnfovjdcobifeupvbn.supabase.co|api.openai.com|api.anthropic.com|api.stripe.com|cloudflare.com|fonts.googleapis.com' -Path C:\Users\Owner\HYDI_System\artifacts\hydi-network-capture.txt
```

## Expected Result

With the Phase 2/3/8/9 changes in place and the vendored Deno modules, the capture should show only:

- `127.0.0.1:54321` (local Supabase)
- `127.0.0.1:54322` (direct Postgres, if used)
- `127.0.0.1:3000` (Next.js server)
- `127.0.0.1:11434` (Ollama)
- No packets to `*.supabase.co`, `api.openai.com`, `api.anthropic.com`, `api.stripe.com`, `cloudflare.com`, or `fonts.googleapis.com`.

## Status

**Phase 10 is blocked in this environment.** The code changes required for a clean local-first boot are in place, but a real packet-capture proof requires Docker Desktop running and an Administrator PowerShell session. Re-run the procedure above on a host with both to obtain the capture log.
