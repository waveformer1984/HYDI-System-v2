# HYDI System — Knowledge Base

## System Identity
- **Name:** HYDI (Hybrid Digital Intelligence)
- **Production root:** `C:\Users\Owner\HYDI_System`
- **Stack:** Next.js + Supabase + Node.js workers + Python governance layer
- **Package name:** `heidi-cascade-production` v1.0.0
- **Last verified healthy:** 2026-05-19 (6/6 health checks passing)

## Core Directories

| Directory | Purpose | Last Active |
|---|---|---|
| `heidi-core/` | Cascade engine, AI self-awareness, Supabase bridge | May 2026 (active) |
| `governance/` | Shadow governance, trade gate, hooks | May 2026 (active) |
| `hydi_scripts/` | main.py, trading_loop.py | May 2026 (active) |
| `agents/` | Agent fleet: heidi, ursula, kilo, hyve, bus, consensus | May 2026 |
| `workers/` | 21 worker modules: Revenue, Sync, Security, Notification | Apr 2026 |
| `src/` | Next.js frontend source | May 2026 |
| `supabase/` | Migrations and schema definitions | Apr 2026 |
| `audit/` | Audit trail records | Apr 2026 |
| `knowledge_base/` | System documentation (this file) | May 2026 |
| `scripts/` | health-check.ps1, backup-critical.ps1 | May 2026 |

## Agent Fleet

| Agent | Role |
|---|---|
| heidi | Core intelligence, self-awareness |
| ursula | Unknown — needs documentation |
| kilo | Unknown — needs documentation |
| hyve | Unknown — needs documentation |
| bus | Event bus coordinator |
| consensus | Decision consensus layer |
| pipeline | Execution pipeline |
| hid | HID controller interface |
| hardware-controller | Hardware interface |
| specialized | Specialized task agents |

## Key Files
- `heidi-core/index-clean-3458.js` — Main HEIDI server (port 3458)
- `heidi-core/cascade-v3-clean.js` — Production cascade engine
- `heidi-core/server.js` — Alt server entry point
- `heidi-core/HeidiSelfLaunchProtocol.js` — Self-launch automation
- `heidi-core/global-drift-evaluator.js` — Drift evaluation (syntax fixed 2026-05-19)
- `heidi-core/Start-Heidi-Robust.ps1` — Startup script (syntax fixed 2026-05-19)
- `governance/shadow_governance_integration.py` — Pre-trade governance gate
- `governance/hydi_governance_hooks.py` — Trade execution hooks
- `hydi_scripts/main.py` — Main orchestration script
- `hydi_scripts/trading_loop.py` — Trading loop

## Cognitive Loop (from PR #46)
Files in `C:\Users\Owner\.claude\worktrees\fervent-mendel-963294\.claude\HYDI_System\HYDI_Core\`:
- `HydiCognitiveLoop.py` — ReAct agent loop (claude-opus-4-7, 80K token budget)
- `HydiGovernance.py` — Fail-closed governance gate, SHA-256 audit chain
- `HydiGovernanceHooks.py` — Process-scoped singleton, `evaluate_trade()` entry point
- `HydiMemory.py` — JSON-file knowledge store, keyword-overlap retrieval
- `HydiToolSandbox.py` — Sandboxed subprocess executor (no exec(), no credential access)
- `test_governance.py` — 7-test suite, 13 assertions (all passing as of 2026-05-19)

## HEIDI Server API (port 3458)
- `GET  /health` — System status, model name, session/task counts
- `POST /think` — Send `{ input, sessionId }` → Ollama LLM response (requires Ollama running)
- `POST /task` — Create task: `{ title, description, priority, source }`
- `GET  /tasks` — List all tasks
- `DELETE /session/:id` — Clear session history
- `GET  /revenue/*` — Revenue governance endpoints (anti-misalignment, calibration, etc.)

## LLM Backend
- **Model:** `llama3.2:latest` via Ollama at `http://127.0.0.1:11434`
- **Start Ollama:** `ollama serve`
- **Note:** HEIDI server stays up without Ollama; only `/think` calls fail

## Cascade Data
- Runtime cascade JSON files generate in `heidi-core/data/` during operation
- `heidi_memory.json` (lowdb) stores persistent HEIDI memory state
- Backup target: `heidi-core/data/*.json` files when they exceed 1MB

## Supabase
- URL and keys configured in `.env` (quoted values: `SUPABASE_URL="https://..."`)
- Schema migrations in `supabase/` and `migrations/`
- Workers connect via `@supabase/supabase-js`
- Project ref: `akbnfovjdcobifeupvbn`

## Backup Schedule
- **Target:** Run `scripts/backup-critical.ps1` weekly
- **Location:** `C:\Users\Owner\HYDI_System_BACKUP\backup_YYYYMMDD_HHMMSS\`
- **Retention:** 30 days
- **Last backup:** 2026-05-19 (backup_20260519_162854)

## Health Check
Run `scripts/health-check.ps1` to verify system state. Checks:
1. Node/Python processes + HEIDI endpoint + Ollama backend
2. C: drive disk space (warn < 10 GB)
3. Orphaned .py files in TEMP
4. Cascade data JSON files (runtime-generated)
5. Supabase credentials in .env (handles quoted values)
6. Knowledge base content
7. Backup age (warn if > 7 days)

## Known Gaps (as of 2026-05-19)
- Ollama not running — `/think` endpoint requires `ollama serve` first
- Agent documentation missing for: ursula, kilo, hyve, hid, specialized
- Workers (21 modules) not running — start via `npm start` in heidi-core/
- `KEEPER_BREAK_GLASS_TOKEN` in .env is placeholder — needs real value
- `GEMINI_API_KEY` in .env is placeholder — needs real value

## Disk Layout
- **C: drive:** 430 GB used / 457 GB total (C: at ~94% — monitor)
- **F: drive:** 16.8 GB used / 224 GB total (207 GB free — overflow destination)
- **Claude worktrees:** `C:\Users\Owner\.claude\worktrees\`
- **npm global:** `C:\Users\Owner\AppData\Roaming\npm` (3.9 GB)
- **Claude vm_bundles:** `C:\Users\Owner\AppData\Roaming\Claude\vm_bundles` (13 GB — required, do not delete)

## GitHub
- **Repo:** `waveformer1984/HYDI-System-v2`
- **Primary branch:** `clean-main`
- **PR #46:** Cognitive loop + governance gate (merged candidate)
