# Heidi operational inventory (Frank prep)

Generated for SPP Heidi Operational Prep. Evidence commands at bottom.

## Service table

| Path / entry | What it does | PM2 name | Port | Notes |
|---|---|---|---|---|
| `heidi-core/server.js` | Express orchestrator: chat, missions, memory, ops commands, morning brief | `heidi-core` | **3459** (`HEIDI_PORT`) | Canonical brain service; `HEIDI_ALLOW_EXEC=false` in PM2 env |
| `pages/` + `node_modules/next` | Dashboard, `/heidi` mobile PWA, `/api/heidi-mobile/*` BFF | `heidi-web-standalone` | **3000** | Canonical phone path (Tailscale `/heidi`) |
| `launch-heidi-mobile.js` | Legacy standalone mobile chat API (Ollama relay) | `heidi-mobile-chat` | **3006** | **Legacy** — retire in Phase 3; not in default `tailscale serve` path |
| `protoforge-core` (boot / PM2) | CASCADE/KILO/ProtoForge pipeline | `protoforge-core` or boot-child | **3005** | Phone ops read via BFF upstream |
| `services/lifeline/server.js` | Tailnet PM2 restart when :3000 down | `lifeline` (separate pm2 config) | **3090** (loopback) | PR #660; `tailscale serve :8443` |
| `heidi-core/heidi-agent.js` | Persistent agent loop (bounds, events) | `heidi-agent` | **3462** area | Advisory/agent port per `boot.config.json` |
| `ursula-local` Next app | Ursula console | `ursula-local` | **3100** | Per `config/ports.json` |
| `ollama` (external) | Local LLM + embeddings | not PM2 (OS service) | **11434** | $0 inference |
| Local Supabase | Postgres + REST | Docker / `supabase start` | **54321** | `heidi_*` tables |
| `heidi-core/index-clean.js` | **Old dev entry** | no | **3456** default | **Stale** — not registry; use 3459 |
| `hydi-showcase.html`, `hydi-*-demo.html` | Static demos | no | n/a | Hardcode **localhost:3456** API — wrong port |

## Port registry (`config/ports.json`)

| Key | Port |
|---|---|
| `next-app` | 3000 |
| `protoforge-core` | 3005 |
| `heidi-mobile-chat` | **3006 (legacy)** |
| `heidi-core` | **3459** |
| `ursula-local` | 3100 |
| `ollama` | 11434 |

**3456** is **not** in `config/ports.json`. References are historical (see §3456 audit).

## `heidi_*` Supabase migrations (repo)

| Migration | Tables / purpose |
|---|---|
| `20260429150000_heidi_memory_layer.sql` | `heidi_reflections`, memory layer |
| `20260617000005_heidi_orchestrator_schema.sql` | Orchestrator + reflections notes |
| `20260626130000_heidi_event_loop_schema.sql` | `heidi_events`, `heidi_reflections` shape |
| `20261013100000_heidi_decision_bounds_live.sql` | `heidi_decision_bounds` live columns |
| `20261113000000_heidi_state_snapshots.sql` | `heidi_state_snapshots` |
| `20260930000000_heidi_missions.sql` | missions |
| Others | proposals, cognitive core, operator lease, goals |

## Four tables — read / write map

### `heidi_state_snapshots`

| Op | Path |
|---|---|
| **W** | `lib/heidi/CognitiveCore.ts` (`INSERT`), `lib/heidi/agent-persistent-loop.js`, `heidi-core/jobs/operational-heartbeat.js` (this prep) |
| **R** | `lib/heidi-mobile/agent-state-read.js`, `lib/hydi/doctor.js` (freshness), tests |

### `heidi_events`

| Op | Path |
|---|---|
| **W** | `heidi-core/heidi-agent.js`, `api/events/ingest.js`, `lib/heidi/CognitiveCore.ts`, `lib/action-executor.ts`, `pages/api/workspace/*`, `heidi-core/jobs/lead-sweep.js` (digest), many scripts |
| **R** | `true-system-health.js`, `scripts/hydi-verify.js`, `pages/ops.tsx`, evolution assessors, tests |

### `heidi_reflections`

| Op | Path |
|---|---|
| **W** | `heidi-core/heidi-agent.js`, `modules/heidi-reflection-engine.js` |
| **R** | `heidi-core/heidi-agent.js`, tests |

### `heidi_decision_bounds`

| Op | Path |
|---|---|
| **R/W** | `heidi-core/heidi-agent.js` (read bounds, lease fields) |
| **R** | `scripts/gate-drill.js`, `lib/heidi/AuthorityBounds.js` (via code), MCP `decision_bounds` tool, tests |

## 3456 reference audit (flagged)

| Path | Issue |
|---|---|
| `heidi-core/README.md`, `setup.js`, `test.js`, `Start-Heidi*.ps1` | Docs/scripts assume **:3456** |
| `heidi-core/seed-local-facts.js` | Seeds wrong port into `hydi_facts` |
| `heidi-core/index-clean.js` | `PORT = 3456` |
| `hydi-showcase.html`, `hydi-diagnostic-proof.html`, `hydi-evolve.html`, `hydi-intro-demo.html` | UI calls **3456** |
| `docs/DISCREPANCIES.md`, `AUDIT.md` | Document 3456 as closed / stale |

Canonical production port per registry + PM2: **3459**.

---

## Evidence (commands run 2026-11-26)

```text
$ git branch --show-current
heidi-operational-prep

$ rg -l "heidi_" supabase/migrations config/ports.json ecosystem.config.js heidi-core | head -20
supabase/migrations/20260429150000_heidi_memory_layer.sql
supabase/migrations/20260626130000_heidi_event_loop_schema.sql
...
heidi-core/heidi-agent.js
heidi-core/server.js

$ rg "name: 'heidi" ecosystem.config.js
      name: 'heidi-core',
      name: 'heidi-web-standalone',
      name: 'heidi-agent',
      name: 'heidi-mobile-chat',
      name: 'heidi-pool',

$ rg "heidi-mobile-chat" config/ports.json
    "heidi-mobile-chat": {
      "port": 3006,

$ rg "\b3456\b" -l --glob '!node_modules/**' | head -15
hydi-showcase.html
heidi-core/seed-local-facts.js
heidi-core/index-clean.js
heidi-core/README.md
docs/DISCREPANCIES.md
AUDIT.md
...

$ rg -l "heidi_state_snapshots" .
lib/heidi/CognitiveCore.ts
lib/heidi/agent-persistent-loop.js
supabase/migrations/20261113000000_heidi_state_snapshots.sql
...

$ rg "from\\('heidi_events'\\)" -l . | wc -l
40+ paths (ingest, agent, workspace APIs, scripts)
```