# Archived: dead Vercel configuration

Moved here 2026-07-16 as Phase 0 of `LOCAL_FIRST_EXECUTION_PLAN.md`.

Vercel deployment is confirmed unused — per `CLAUDE.md`'s Local-First
Architecture decision (2026-07-10), no git integration is linked to the
Vercel project (`link: undefined` via the Vercel API) and nothing
auto-deploys on push. These files were the last remaining artifacts that
implied otherwise:

- **`vercelignore.txt`** (was root `.vercelignore`) — Vercel-CLI-specific
  ignore rules for a deploy that never happens.
- **`ursula-frontend-vercel.json`** (was `apps/ursula-frontend/vercel.json`)
  — that sub-app actually runs via the PM2 fleet (`ecosystem.config.js`),
  not Vercel.
- **`cloud-bootstrap-vercel.js`** (was `scripts/cloud-bootstrap/vercel.js`)
  — the `verify()`/`provision()` module for auto-provisioning a Vercel
  project. Removed from `scripts/cloud-bootstrap/index.js`'s `SERVICES`
  map in the same commit; `supabase` and `stripe` remain.

**Deliberately not touched**: `hydi-monitor-deploy/vercel.json` — that
directory is a separate stale sub-deployment already flagged in
`ROADMAP.md`'s P1 list ("consolidate the 4 parallel, unreachable Stripe
checkout/webhook implementations"), and archiving it is bundled into that
larger, still-open maintainer decision rather than this narrower cleanup.
`.github/workflows/health-monitor.yml`'s `vercel-api-check.js` step is also
untouched — it's an intentionally-kept read-only diagnostic, not a deploy
trigger.
