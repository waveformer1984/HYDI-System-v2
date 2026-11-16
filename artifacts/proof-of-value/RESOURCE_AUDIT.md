# RESOURCE_AUDIT

## Cloud agent VM (this audit — 2026-11-16)

| Metric | Value | Notes |
|--------|-------|-------|
| RAM total | 15 GiB | |
| RAM used | ~13 GiB | pressure high |
| RAM available | ~2.3 GiB | |
| Swap | 0 | no swap |
| Supabase start | failed | likely memory/Docker setup |

Many stale `node .../hang.js` processes observed (scheduler artifacts).

**Impact:** Full `npm test` + Supabase simultaneously is risky on cloud; prefer targeted suites (`npm run test:pov`).

## Frank (heidi-pc) — not directly measured this audit

Documented production constraints from `CLAUDE.md` / ops reports:

| Area | Known risk |
|------|------------|
| Docker Desktop / WSL2 RAM | Supabase stack needs ≥6 GB WSL |
| Ollama model RAM | Competes with Next build (auto-deploy OOM history) |
| PM2 process count | `ecosystem.config.js` — audit via `npm run runtime:audit` on Frank |
| Disk | `frank-storage-guard` tiers on free space |
| `.next` build vs serve | Staging dir to avoid serving incomplete builds |

## Recommendations (Frank)

1. Run `npm run runtime:audit` and fix STALE_CODE / MISSING rows before new deploys.
2. Keep auto-deploy paused when free RAM < `HYDI_DEPLOY_MIN_FREE_RAM_GB`.
3. Do not load extra Ollama models during Next production builds.
4. On cloud CI: rely on GitHub Actions for full Jest + Supabase, not oversized parallel local runs.

## Before/after

No Frank before/after captured in this turn — **BLOCKED_EXTERNAL**.