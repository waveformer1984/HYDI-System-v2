# Discrepancies — owner notes vs verified reality

Phase 0 audit, 2026-11-07. Every claim below was checked against the repo
(`clean-main` @ `bc82c99a`), the live PM2 fleet (`pm2 jlist`), listening
ports, and the local Supabase REST API. "Verified" = observed live.

## PM2 service names — notes are stale

| Owner note | Verified reality |
|---|---|
| PM2 services `heidi`, `hydi-processor`, `hydi-protoforge` (cluster ×2), `hydi-ursula` | **None of these exist.** Actual fleet is 26 apps in `ecosystem.config.js` — see `docs/ARCHITECTURE.md`. `hydi-ursula` crash-looping on :3005 is impossible: no such app; `ursula-local` (:3100) is online. |
| `start-heidi-everything.ps1` launches Heidi Bridge :3456, Mobile :3006, Forge Loop :3459, Ursula Suite | The script in-repo is already scoped to this machine: it starts Ollama, heidi-core **:3459**, mobile **:3006**, heidi-bridge **:5050** (external `C:\ProtoForge_Ecosystem`), and Next :3000 — all port-checked and idempotent. No "Forge Loop" or "Ursula Suite" blocks exist in it. heidi-core is :3459, not :3456. |
| Overlap between PM2 and the PS1 is "probable" | Partially true by design: the PS1 launches the same services PM2 supervises (`pm2 start ecosystem.config.js` is the documented path in CLAUDE.md). Running both is redundant but the PS1 skips occupied ports. Phase 2 makes PM2 the only manager. |

## Heidi agent / Supabase tables

| Owner note | Verified reality (local Supabase :54321, REST `count=exact`) |
|---|---|
| `heidi_state_snapshots`, `heidi_events`, `heidi_reflections` have zero rows | `heidi_events` has **262,987 rows**. `heidi_reflections` exists with 0 rows. `heidi_state_snapshots` returns **404 — table does not exist** in the local DB. |
| `heidi_decision_bounds` has one config row | Confirmed: 1 row. |
| "Nothing has ever confirmed heidi-core/server.js starts" | heidi-core is PM2 `online` and :3459 answers (verified this session). Whether it writes `heidi_events` boot rows is a Phase 3 check. |
| `hydi_tasks`, `agent_bus` seeded? (not stated) | Both exist, **0 rows**. `hydi_facts` has 43 rows. `divisions` table does not exist locally (404). |

## Ports / registry

| Owner note | Verified reality |
|---|---|
| "Write `config/ports.json` as the single port registry" | A registry already exists: **`.ports.json`** at repo root, consumed by `scripts/check-ports.js` and `start-heidi-everything.ps1`. Creating `config/ports.json` would create a second source of truth. Kept `.ports.json`; `docs/PORTS.md` is generated from it. (Decision flagged for Jordan — see Phase 1.) |
| `heidi-bridge` port | `.ports.json` says **5050**, not 3456. The live bridge file is `C:\ProtoForge_Ecosystem\heidi-bridge.py` (outside this repo) and is currently **not running**. |
| Port 3001 | `.ports.json` assigns `supabase-rest` to 3001, but PM2 `rezonate-app` binds **3001**. Registry/code conflict — flagged for Phase 2. |
| Ports 8765/8766/8767 (Termux-era) | Not in `.ports.json`, nothing listens on Frank. Dead. |

## Phone / Termux

| Owner note | Verified reality |
|---|---|
| `heidi.py` advisor needs `qwen2.5:3b-instruct-q4_K_M`; llama.cpp `mistral-7b` on :8080 | Cannot verify from Frank — phone-side state. Frank's Ollama (:11434, PM2-bounded) is the intended inference endpoint; `OLLAMA_MAX_LOADED_MODELS=1`, ctx 4096. |
| Frank IP hardcoded `192.168.1.100` in `~/.termux/boot/start_hydi.sh` | Phone-side file; flagged for Phase 7 (replace with env/MagicDNS). Tailnet name `heidi-pc.tailc50af2.ts.net` is the better target. |
| `HEIDI_MOBILE_TOKEN` | **Not recoverable** — it lived only in the dead PM2 daemon's env. `heidi-mobile-chat` exits 78 without it (`HEIDI_MOBILE_REQUIRE_TOKEN=1`). Regenerating breaks Jordan's existing pairing → Jordan decision. |

## Vercel / cloud

| Owner note | Verified reality |
|---|---|
| Vercel project Ursila, `/api/hydi/sync` contract | The Ursila Vercel codebase is **not in this repo** — `api/voice-agent.mjs`, `api/_store.js`, `api/tasks/` do not exist here. `apps/ursula-frontend` is a different app (local :3100). The sync contract must be verified against the Vercel project directly (Phase 6). |
| `api/voice-agent.mjs` uses paid GPT-4o-mini, conflicts with $0 | Confirmed it would conflict **if** it exists in the Vercel project; it is not in this repo. Flag for `docs/VERCEL_AUDIT.md`. |
| Stripe webhook secret status unknown | `hydi-stripe-webhook-listener` is PM2-online; `api/stripe-connect-webhook.js` exists in-repo. Secret presence not verified (env-only). |

## Environment / tooling

| Owner note | Verified reality |
|---|---|
| "You can't reach Frank, the phone or local folders directly" | **This session runs on Frank** (`C:\Users\Owner`, PM2, Docker all local). Owner notes appear written for a cloud Devin session. Runbook scripts are still produced per phase for Jordan-run verification, but direct verification is possible and was used. |
| ~50 Hydi folders | Verified ~55 candidates under `C:\Users\Owner` (see inventory output / Phase 1 plan). `HYDI_System` is at `C:\Users\Owner\HYDI_System` (not `F:\`). |
| `HYDI_System` is "PM2-run" | PM2 `pm_cwd` for every app is `C:\Users\Owner\HYDI-System-v2`. `HYDI_System` is the stale `release/v0.9.0` clone per CLAUDE.md — not PM2-run. |
| `claude/local-mobile-chat-app-c3UBW` dirty branch | Not found in `git branch -a` output during Phase 0 scan — recheck in Phase 1. |
| GitHub Actions "reportedly stopped dispatching" | Not yet verified (Phase 4/remote-CI investigation). Repo is public; `gh` is authenticated. |

## Runtime state snapshot (2026-11-07, post-recovery)

- PM2 daemon was lost once this session (OOM); fleet restarted clean via
  `pm2 start ecosystem.config.js`; `pm2 save` updated.
- Listening: 3000, 3001, 3005, 3100, 3459, 11434, 54321.
  Closed: 3006 (token), 5050 (bridge not running), 3461 (advisory off).
- `runtime:audit`: 21 OK; `hydi-boot` STALE_CODE (dirty tree at start),
  `ursula-local`/`ollama-serve`/`hydi-billing-worker` provenance gaps —
  fixes on branch `fix/runtime-provenance-gaps`.
