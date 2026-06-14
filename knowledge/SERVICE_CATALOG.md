# Service Catalog — HYDI / ProtoForge Ecosystem

Last updated: 2026-06-14  
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
- `GET /api/registry/status` — unified service registry (see §11)
- `GET /api/memory/:deviceId/facts` — list recalled semantic-memory facts (see §12)
- `DELETE /api/memory/:deviceId/facts` — clear semantic-memory facts for a device
- `POST /api/plan` — standalone multi-step plan generation (see §13)
- `GET /api/agent/status` — agent loop state (see §14)
- `GET /api/agent/log` — last 20 cycle entries
- `GET /api/agent/pending` — pending actions awaiting operator authorization
- `POST /api/agent/run` — trigger an immediate agent cycle
- `POST /api/agent/authorize/:id` — authorize a queued action
- `DELETE /api/agent/pending/:id` — reject a queued action
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
- `push_subscriptions` — VAPID web push registrations (endpoint, p256dh, auth, active)
- `worker_status` — heartbeat + status rows written by WorkerOrchestrator workers

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

## 11. Service Registry

| Field | Value |
|---|---|
| **File** | `launch-heidi-mobile.js` (built-in) |
| **Endpoint** | `GET /api/registry/status` |
| **Status** | Active |

Probes all 7 components in parallel and returns structured health data:

| Service key | What it probes | Detail returned |
|---|---|---|
| `heidi` | self | uptime string |
| `ollama` | `/api/tags` | model count |
| `bridge` | `${URSULA_URL}/health` | status string |
| `supabase` | `push_subscriptions` count query | active sub count |
| `forge` | bridge `/api/builds` or local `build_registry.json` | latest build # + status |
| `workers` | `worker_status` table row count | healthy/total |
| `push_subs` | in-memory `webPushSubs` Map | device count |

Each entry: `{ ok: bool, latency_ms: number, detail: string }`. The QA drawer in Heidi UI auto-fetches and refreshes every 30 s when open.

**Known gaps vs full HYDI Service Registry spec:** `/api/system/restart/:id`, aggregate health score formula, event log endpoint.

---

## 12. Semantic Memory

| Field | Value |
|---|---|
| **File** | `heidi-semantic-memory.js` |
| **Storage** | `.heidi-memory.json` (local) — Supabase upgrade path: `setup-semantic-memory.sql` |
| **Embedding model** | `nomic-embed-text` (Ollama) → falls back to `mxbai-embed-large` → `tinyllama` |
| **Status** | Active — wired into `/api/chat` |

**How it works:**
1. Before each chat response: embeds the user message and recalls top-4 memories with cosine similarity ≥ 0.72
2. Recalled facts are injected into the system prompt as "RELEVANT MEMORY" section
3. After each response: `extractAndStore()` asks Ollama to pull 1–3 notable facts and stores them with embeddings
4. Deduplication: skips memories with >0.95 cosine overlap to the existing store

Max 500 memories per device. Per-device scope via `deviceId` UUID sent in chat POST body.

---

## 13. Heidi Planner

| Field | Value |
|---|---|
| **File** | `heidi-planner.js` |
| **Endpoint** | `POST /api/plan` body: `{ goal, deviceId }` |
| **Status** | Active — auto-triggers on complex chat messages |

`needsPlan()` uses regex heuristics to detect multi-step intent (keywords: plan, roadmap, set up, build … and, automate, workflow, etc.). When triggered during `/api/chat`, `generatePlan()` asks Ollama to decompose the goal into 3–7 numbered steps, prepends the formatted plan to the streaming response, and injects the step list into the system prompt context for follow-up.

`/api/plan` can also be called directly to get a plan without running the full chat pipeline.

---

## 14. Autonomous Agent Loop

| Field | Value |
|---|---|
| **File** | `heidi-agent-loop.js` |
| **Class** | `HeidiAgentLoop extends EventEmitter` |
| **Default interval** | 15 min (`AGENT_LOOP_INTERVAL_MIN`) |
| **Autonomy level** | `alert_only` (`AGENT_AUTONOMY_LEVEL`) |
| **Reasoning model** | `llama3.2` (`AGENT_REASONING_MODEL`) |
| **Status** | Active when `AGENT_LOOP_ENABLED=true` |

**SAFETY INVARIANT:** The loop can never take consequential action autonomously. It can only (a) send a push notification or (b) queue a `pending` action that requires operator `CONFIRM` via `POST /api/agent/authorize/:id`.

**Cycle pipeline:**
1. `_observe()` — probes service registry, revenue delta (Supabase ledger last 24h vs prior 24h), forge build via bridge
2. `_reason()` — sends observation summary to Ollama with `format:'json'`, `temperature:0.15`; falls back to `_ruleBasedDecision()` if Ollama is unreachable
3. `_act()` — dispatches `send_alert` (push) or `queue_revenue_review` (pending auth), never acts beyond that

**Rule-based fallback thresholds:**
- `send_alert` → any service down (excluding push_subs), forge failure, or revenue drop >20% vs prior day
- `queue_revenue_review` → revenue delta >$50 vs prior day

**API endpoints (wired into `launch-heidi-mobile.js`):**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agent/status` | Current loop state (enabled, interval, cycle count, pending count, next_run) |
| `GET` | `/api/agent/log` | Last 20 cycle log entries |
| `GET` | `/api/agent/pending` | All pending actions awaiting authorization |
| `POST` | `/api/agent/run` | Trigger an immediate cycle |
| `POST` | `/api/agent/authorize/:id` | Authorize a pending action (sets status→authorized, emits `action_authorized`) |
| `DELETE` | `/api/agent/pending/:id` | Reject/dismiss a pending action |

**Env vars:** `AGENT_LOOP_ENABLED`, `AGENT_LOOP_INTERVAL_MIN`, `AGENT_AUTONOMY_LEVEL`, `AGENT_REASONING_MODEL`

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
