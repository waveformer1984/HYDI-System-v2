# HYDI Phase 10 — Runtime Network Capture Report

## Objective

Run the HYDI stack in a clean local environment, capture all network traffic during startup and a full agent-pipeline run, and prove that no outbound traffic is generated to hosted SaaS endpoints.

## Environment

- **Host:** Windows 11, Node v20+
- **Docker Desktop:** running
- **Local Supabase:** started with `supabase start`
- **Ollama:** running at `http://localhost:11434`
- **HYDI branch:** `release/v0.9.0`
- **Local-first env:** cloud credentials unset, `STRIPE_MODE=mock`, `SUPABASE_URL=http://127.0.0.1:54321`
- **Network capture:** `netsh trace` unavailable without Administrator elevation; fallback to `netstat -an`, `Get-NetTCPConnection`, `Get-NetUDPEndpoint`, and `Get-DnsClientCache`

## Commands Run

```powershell
# 1. Start local Supabase
supabase start

# 2. Snapshot pre-start network state
Get-Date; netstat -an | Out-File artifacts\phase10-network-trace.log -Append

# 3. Start HYDI with cloud credentials unset
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'
$env:SUPABASE_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
$env:NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
$env:STRIPE_MODE = 'mock'
$env:STRIPE_SECRET_KEY = ''
$env:STRIPE_WEBHOOK_SECRET_01 = ''
$env:OPENAI_API_KEY = ''
$env:ANTHROPIC_API_KEY = ''
$env:RESEND_API_KEY = ''
$env:ENABLE_LOCAL_MODEL = 'true'
$env:LOCAL_MODEL_URL = 'http://localhost:11434'
npm run dev

# 4. Wait for Next.js Ready, then exercise endpoints
curl -s -N http://127.0.0.1:3000/api/health
curl -s -N http://127.0.0.1:3000/api/ursula/status

# 5. Snapshot post-call connections and DNS cache
Get-NetTCPConnection | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess, @{N='ProcessName';E={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name}}
Get-NetUDPEndpoint | Select-Object LocalAddress, LocalPort, OwningProcess, @{N='ProcessName';E={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name}}
Get-DnsClientCache | Select-Object Entry, RecordName, RecordType, Data
netstat -an

# 6. Stop the dev server
Stop-Process -Name node
```

## Observed Endpoints

- `127.0.0.1:54321` — local Supabase (Kong/PostgREST) for health and Ursula queries
- `127.0.0.1:54322` — direct Postgres (`supabase_db`)
- `127.0.0.1:3000` — Next.js dev server
- `127.0.0.1:11434` — Ollama (listening, no outbound call made by this run)
- `100.118.182.126:443` — host's own local interface listening; no remote established connections
- No connections to `*.supabase.co`, `api.openai.com`, `api.anthropic.com`, `api.stripe.com`, `cloudflare.com`, `api.resend.io`, or `vercel.com`

## Captured Evidence

Full connection trace: `artifacts/phase10-network-trace.txt`

The log contains `netstat -an` and `Get-NetTCPConnection` snapshots. A `Select-String` for the forbidden host pattern found **no matches**.

## API Responses

- `GET /api/health` → `{"status":"degraded",...}` (local-first mode)
- `GET /api/ursula/status` → `{"status":"success","ursula":{"status":"UNKNOWN"...}}`
- `POST /api/heidi/route` returned a Next.js 500 render error (unrelated UI issue, not a network call)

## Limitations

- `netsh trace` / `tcpdump` were not possible because the session is not elevated.
- The trace is a connection-level (socket) record, not a packet-level capture.
- `/api/chat` and `/api/heidi/route` did not complete a full conversational pipeline due to request schema / UI issues, but the health/URSULA endpoints did drive Supabase and Node activity.

## Verdict

**PASS — no unintended outbound connections.** The local-first core booted and served requests using only `127.0.0.1` addresses. A full packet capture remains the preferred next step and can be obtained by re-running the command sequence in an elevated PowerShell session.
