# HYDI / ProtoForge operational plan (Phases 0–10)

**Integration branch:** `clean-main`  
**Agent run:** 2026-11-07  
**Tracking:** tick boxes as phases land; details in `PHASES_COMPLETE.md`.

## Decisions (fixed for this run)

- [x] PM2 only on Frank (`start-heidi-everything.ps1` = thin wrapper)
- [x] `HYDI-System-v2` canonical; no prod secrets in repo
- [x] `HEIDI_ALLOW_EXEC=false` default; archive script dry-run default
- [x] $0 cost (Ollama local); dotenvx + `.env.example`
- [x] No destructive ops from cloud agent

---

## Phase 0 — Ground truth

- [x] `docs/ARCHITECTURE.md`
- [x] `config/ports.json` + `.ports.json` (sync script)
- [x] `docs/PORTS.md` (generated)
- [x] `docs/DISCREPANCIES.md`
- [x] `scripts/frank/inventory.ps1` (read-only)

## Phase 1 — Consolidation

- [x] `docs/CONSOLIDATION_PLAN.md`
- [x] `scripts/frank/archive-folders.ps1` (dry-run default)
- [x] CONTRIBUTING branch / worktree notes
- [ ] Jordan: approve archive dry-run output (see `docs/NEEDS_FROM_JORDAN.md`)

## Phase 2 — PM2 orchestration

- [x] Thin `start-heidi-everything.ps1`
- [x] `scripts/frank/port-doctor.ps1`
- [x] Port registry check (`scripts/check-port-registry.js`)
- [x] `/health` contract (`docs/HEALTH_CONTRACT.md`)
- [x] PM2 backoff on ecosystem entries (pre-existing)
- [x] `docs/runbooks/windows-autostart.md`
- [ ] `ecosystem.config.js` ports imported from registry (enforced via check, not codegen)

## Phase 3 — Heidi core boot proof

- [x] `lib/store/*` adapters
- [x] `heidi_events` boot row on startup
- [x] Memory/sqlite init fixes
- [x] `tests/unit/store-adapter.test.js`

## Phase 4 — Governed agent

- [x] `lib/governance/tripleGate.js` + 100% unit tests
- [x] `lib/governance/action-registry.js`
- [x] Pause / kill switch (`HEIDI_PAUSE`)
- [x] Lease + tick loop (pre-existing in `heidi-agent.js`)

## Phase 5 — Memory + divisions

- [x] Divisions migration + migration test
- [x] `scripts/seed-divisions.js` (10 idempotent placeholders)
- [x] `scripts/backfill-embeddings.js` (dimension gate; needs Jordan decision)
- [ ] pgvector retrieval wired into agent prompt (blocked: 1536 vs 768)

## Phase 6 — Local-first sync

- [x] `docs/LOCAL_SYNC_CONTRACT.md`
- [x] `tests/unit/hydi-sync-contract.test.js`
- [x] `docs/VERCEL_AUDIT.md`
- [x] Tailscale cross-links in `docs/TAILSCALE.md` + contract doc

## Phase 7 — Phone thin client

- [x] `docs/PHONE_ENV_URLS.md`
- [x] `scripts/phone/*.sh` curl probes
- [x] `docs/runbooks/phone-phantom-killer.md`
- [x] Port reconcile notes in `PHONE_ENV_URLS.md`

## Phase 8 — Ursula hub

- [x] Hub via `config/portfolio.json` (documented)
- [x] Persistent Heidi chat (`docs/URSULA_HEIDI_PANEL.md` — pre-existing)
- [x] `config/workspaces.template.json` (Rezonate, Lead Forge, Proto.I.Y.)
- [x] `docs/URSULA_HUB_WORKSPACES.md`

## Phase 9 — Heidi Life (mock)

- [x] Mock stream fixtures + opt-in env flags
- [x] Read-only suggestions API route
- [x] `docs/HEIDI_LIFE_MOCK_STREAMS.md`

## Phase 10 — Verify + CI handoff

- [x] `scripts/hydi-verify.js`
- [x] `docs/OPERATIONS.md`
- [x] `.github/workflows/hydi-verify.yml`
- [x] Final `PHASES_COMPLETE.md` sections 6–9

## Jordan aggregation

- [x] `scripts/frank/run-all-pending.ps1`
- [x] `scripts/phone/run-all-pending.sh`
- [x] `docs/NEEDS_FROM_JORDAN.md`
- [x] `docs/ASSUMPTIONS.md`
