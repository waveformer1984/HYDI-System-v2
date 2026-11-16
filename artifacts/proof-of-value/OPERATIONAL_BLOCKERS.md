# OPERATIONAL_BLOCKERS

Prioritized by impact on **P1–P5** (startup → revenue).

## P0 — Ground truth

| ID | Blocker | Impact | Owner action |
|----|---------|--------|--------------|
| B-01 | Frank not reachable from cloud agents | Cannot claim production LIVE | Run `scripts/frank-align-clean-main.ps1` on heidi-pc; optional Tailscale agent join |
| B-02 | Supabase failed to start on cloud VM (`DbSetupError`) | ~25 unit suites + billing PG tier blocked here | Frank/local: `supabase start`; cloud: fix Docker db container logs |

## P1 — Startup & connectivity

| ID | Blocker | Impact | Fix path |
|----|---------|--------|----------|
| B-10 | protoforge-core not running (cloud) | Pipeline metrics, CASCADE live path dead | `npm run boot` or start `node src/server.js` PORT=3005 |
| B-11 | `SUPABASE_*` unset in running Next dev | `/api/health` → `cloud.available: false` | `source .cursor/cloud-agent-env.sh` after Supabase up |
| B-12 | hydi-daemon status stale (>180s) on :3000 health | Health reports unhealthy daemon | Start `hydi-daemon` on Frank or ignore on partial dev |
| B-13 | Frank local-ci eslint (`ESLINT_USE_FLAT_CONFIG`) | PM2 `local-ci` red on DESKTOP-I719OIN | See `docs/reports/FRANK_OPERATIONAL_VERIFICATION.md` |

## P2 — End-to-end execution

| ID | Blocker | Impact | Fix path |
|----|---------|--------|----------|
| B-20 | heidi-core HTTP not started on cloud | No live REST mission approve | Frank: `npm run boot` + mission worker |
| B-21 | `HEIDI_ALLOW_EXEC` / approval gates | Autonomous execution rightly blocked | Use read-only mission or explicit human approve |

## P3 — Mobile

| ID | Blocker | Impact | Fix path |
|----|---------|--------|----------|
| B-30 | `HYDI_SERVICE_SECRET` / mobile token on device | Phone cannot authenticate | Pair via `/api/pair` on Frank tailnet |
| B-31 | Static GitHub Pages shell only | HTML ≠ backend | Point phone at tailnet URL + secret |

## P4 — Evolution 2.0 acceptance

| ID | Blocker | Impact | Fix path |
|----|---------|--------|----------|
| B-40 | No LIVE Frank collector JSON | `FRANK_VERIFIED` impossible | `frank-production-truth-collect.ps1` on Frank |
| B-41 | Live probe rollup UNAVAILABLE | Supervisor truthfulness degraded (by design) | Start full stack + collector |

## P5 — Revenue

| ID | Blocker | Impact | Fix path |
|----|---------|--------|----------|
| B-50 | Stripe + billing secrets missing on cloud | Cannot run sandbox checkout here | Frank: `stripe listen` + env from vault |
| B-51 | No paying customer workflow completed | Mission success criterion open | See `REVENUE_READINESS.md` — billing slice 1 MVP |
| B-52 | Human approval on opportunity pipeline | 24 leads `AWAITING_APPROVAL` | Owner approves one lead; no auto-submit |

## P6 — RAM (Frank)

| ID | Blocker | Impact | Fix path |
|----|---------|--------|----------|
| B-60 | Windows + Ollama + Supabase + Next competing for RAM | OOM deploy rollbacks | `frank-observer`, `runtime:audit`, reduce parallel builds |