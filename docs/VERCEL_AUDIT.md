# Vercel audit (read-only)

**Purpose:** Record what still references Vercel vs local-first Frank. No cancellations performed from cloud agent.

## Repo state

| Item | Status |
|------|--------|
| Active deploy path | PM2 + `ecosystem.config.js` on Frank (`docs/ARCHITECTURE.md`) |
| `archive/dead-vercel-config/` | Archived Phase 0 local-first exit |
| `apps/ursula-frontend/vercel.json` | Archived / unused for production |
| `.github/workflows/deploy-cloudflare.yml` | Optional; secrets-gated skip |
| `docs/index.html` (GitHub Pages) | Static mobile shell only — no backend |

## API parity

Routes that **were** on Vercel and must stay stable for phone clients:

- `api/mobile-status.js`
- `api/hydi/sync.js`
- `pages/api/heidi-mobile/*` (BFF)

Contract: `docs/LOCAL_SYNC_CONTRACT.md`.

## Paid model risk

Historical concern: serverless routes calling paid models. Mitigation in repo:

- `HYDI_ALLOW_PAID_LLM` gate (`lib/cost/paid-llm-gate.js`)
- `npm run cost:audit`

## Jordan actions (not automated)

1. Confirm Vercel project has **no** git auto-deploy (`link: undefined` per `CLAUDE.md`).
2. List remaining env vars in Vercel dashboard vs Frank `.env.local` (names only).
3. When Cloudflare worker serves traffic, follow `docs/VERCEL_EXIT_PLAN.md` — **do not** cancel subs before cutover.

**Paste back for audit log:** `vercel env ls` names only (no values), or "Vercel unused".
