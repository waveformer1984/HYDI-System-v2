# Service Catalog — HYDI / ProtoForge Ecosystem

Last updated: 2026-06-13  
Source: HYDI-System-v2 (mobile stack) + ProtoForge_Ecosystem (PC stack)

---

## 1. Heidi Mobile Chat Server

| Field | Value |
|---|---|
| **File** | `launch-heidi-mobile.js` |
| **Runtime** | Node.js ≥ 20 |
| **Port** | 3006 |
| **Protocol** | HTTP + SSE (text/event-stream) |
| **Start command** | `node launch-heidi-mobile.js` |
| **LAN URL** | `http://192.168.86.82:3006` |
| **Status** | Active — primary user interface |

**Responsibilities:**
- Serves `heidi-mobile-chat.html` PWA to browser/phone
- Streams AI responses from Ollama or LM Studio via SSE
- Executes 14 tools (system, build, revenue, database, Stripe)
- Broadcasts push events to connected SSE clients
- Sends VAPID web push to subscribed devices
- Polls bridge for HYDI system state changes every 15s
- Schedules and delivers daily AI briefing at 08:00

**Key env vars:**
```
PORT=3006
OLLAMA_URL=http://192.168.86.82:11434
URSULA_URL=http://192.168.86.82:5050
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...   # server-side only, never exposed to client
STRIPE_SECRET_KEY=...           # server-side only
```

**Endpoints:**
- `GET /` — serves PWA HTML
- `GET /api/health` — server + Ollama health
- `GET /api/models` — available Ollama/LM Studio models
- `POST /api/chat` — SSE streaming chat with tool calls
- `GET /api/events/stream` — SSE push event bus
- `POST /api/events/push` — ingest external push event
- `GET /api/push/vapid-key` — VAPID public key for web push
- `POST /api/push/subscribe` — register web push subscription
- `POST /api/push/unsubscribe` — remove web push subscription
- `GET /api/forge/badge` — latest build number + status
- `GET /api/system/status` — aggregated backend health
- `POST /api/system/action` — forward event to HYDI/Ursula
- `GET /api/revenue/summary` — ledger totals (requires Supabase)
- `GET /api/revenue/pipeline` — leads/quotes/proposals
- `GET /api/memory/:deviceId` — load chat history from Supabase
- `POST /api/memory/:deviceId` — save chat history to Supabase
- `GET /manifest.json` — PWA manifest
- `GET /sw.js` — service worker (caching + push handler)
- `GET /icon.svg` — app icon

---

## 2. Heidi Bridge

| Field | Value |
|---|---|
| **File** | `heidi-bridge.py` |
| **Runtime** | Python 3.x + Flask |
| **Port** | 5050 |
| **Protocol** | HTTP + SSE |
| **Start command** | `python heidi-bridge.py` (from `C:\ProtoForge_Ecosystem\`) |
| **LAN URL** | `http://192.168.86.82:5050` |
| **Status** | Active — PC-side data bridge |

**Responsibilities:**
- Reads `protoforge.db` (SQLite) directly — tables: alerts, audit_log, capacity_reports, telemetry (614+ rows)
- Reads `build_registry.json` — forge build history
- Proxies requests to Ursula Vercel
- Exposes SSE stream for real-time forge build notifications
- Receives `POST /api/forge/webhook` from `heidi_forge_hook.py`
- Forwards forge events to Heidi Mobile at port 3006

**Key endpoints:**
- `GET /health` — bridge health + DB row counts
- `GET /api/status` — system overview
- `GET /api/builds` — build history from build_registry.json
- `GET /api/forge/status` — current forge cycle state
- `GET /api/metrics` — telemetry metrics
- `GET /api/db/tables` — protoforge.db table listing
- `POST /api/db/query` — SELECT-only SQL against protoforge.db
- `GET /api/bridge/stream` — SSE stream (forge events → Heidi)
- `POST /api/forge/webhook` — receives build completion from forge_runner.py
- `GET /api/rezonate/score` — Rezonate DAW completion score
- `GET /api/system/info` — OS + hardware info

---

## 3. Ollama

| Field | Value |
|---|---|
| **Runtime** | Ollama binary |
| **Port** | 11434 |
| **Start command** | `$env:OLLAMA_HOST = "0.0.0.0"; ollama serve` (PowerShell) |
| **Models available** | `tinyllama:latest`, `qwen2.5-coder:1.5b`, `llama3.2:latest` |
| **Model storage** | `C:\Users\Owner\.ollama\models` |
| **GPU** | Intel Iris Xe (iGPU, 8GB VRAM, Vulkan) |
| **Status** | Active when PC is on and serve command is running |

**Note:** Must be started with `OLLAMA_HOST=0.0.0.0` to be reachable from phone/Termux. Default startup only binds to localhost.

---

## 4. Ursula (Cloud)

| Field | Value |
|---|---|
| **URL** | `https://ursula-nine.vercel.app` |
| **Runtime** | Next.js 16 on Vercel |
| **Framework** | Next.js + Supabase |
| **Status** | Always-on (Vercel managed) |

**Responsibilities:**
- Main execution engine for ProtoForge
- Handles ledger writes, revenue data, checkout session records
- Exposes `/api/health`, `/api/ursula/status`, `/api/revenue`
- Supabase tables: `ledger`, `leads`, `quotes`, `proposals`, `checkout_sessions`, `heidi_chat_sessions`

---

## 5. forge_runner.py

| Field | Value |
|---|---|
| **File** | `C:\ProtoForge_Ecosystem\forge_runner.py` |
| **Runtime** | Python 3.x |
| **Trigger** | Manual or scheduled |
| **Build count** | 546+ builds |
| **Status** | Active |

**Responsibilities:**
- 9-stage build pipeline (stages 1–9, stage 9 = Cleanup)
- Writes build results to `build_registry.json` and `protoforge.db`
- Pushes metrics to Supabase
- Calls `heidi_forge_hook.notify_heidi()` after each build (optional integration)

---

## 6. heidi_forge_hook.py

| Field | Value |
|---|---|
| **File** | `heidi_forge_hook.py` (copy to `C:\ProtoForge_Ecosystem\`) |
| **Runtime** | Python stdlib only — zero dependencies |
| **Status** | Optional drop-in |

**Responsibilities:**
- Fire-and-forget POST to bridge `/api/forge/webhook` after each build
- Never raises, never blocks forge_runner.py

---

## 7. Supabase (Cloud)

| Field | Value |
|---|---|
| **Type** | Managed Postgres + Auth + Storage |
| **Access** | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| **Used by** | Ursula (Vercel), Heidi Mobile Server |
| **Status** | Active (Supabase cloud) |

**Tables used by Heidi:**
- `ledger` — revenue transactions (gross, net, stream, payout_status)
- `leads` — sales pipeline leads
- `quotes` — pipeline quotes
- `proposals` — pipeline proposals
- `checkout_sessions` — Stripe checkout records
- `heidi_chat_sessions` — per-device chat history (device_id, messages, model)

---

## 8. Stripe

| Field | Value |
|---|---|
| **Type** | Payment processing |
| **Integration** | Direct REST API (`https://api.stripe.com/v1/checkout/sessions`) |
| **Connect accounts** | Per revenue stream (6 streams) |
| **Status** | Ready when `STRIPE_SECRET_KEY` is set |

**Revenue streams:**
`galactic_bytes` | `detailer_bot` | `lipi_v2` | `protogrance_aromatics` | `rezonate` | `waveformer_studio`

---

## 9. Protohub (Node)

| Field | Value |
|---|---|
| **Port** | 4000 |
| **Runtime** | Node/Express |
| **Status** | Not currently running |
| **Plans** | JWT auth, Stripe billing (Pro $49, Enterprise $199) |

---

## 10. Rezonette (DAW)

| Field | Value |
|---|---|
| **Repo** | `waveformer1984/rezonette` |
| **Local path** | Not yet cloned to `C:\ProtoForge_Ecosystem\` |
| **Module** | `rezonate_core/protoforge_integration.py` |
| **Status** | Bridge reports "not found" — clone needed |

**Provides:** completion scoring, estimated monthly revenue, pricing tiers, scaffolding suggestions.

---

## Directory Map

```
C:\Users\Owner\HYDI-System-v2\     ← Heidi mobile stack (this repo)
C:\ProtoForge_Ecosystem\           ← forge_runner, bridge, protoforge.db
  heidi-bridge.py
  heidi_forge_hook.py
  forge_runner.py
  protoforge.db
  build_registry.json
C:\Users\Owner\.ollama\models\     ← model weights
```
