# BASELINE_TRUTH — Heidi proof of value

**Auditor:** Cloud agent (independent re-verification)  
**Branch:** `clean-main`  
**Commit:** `855141a4479a827fffc580978b274acca02142b2` (2026-11-16)  
**Environment probed:** Cursor cloud VM + partial local Next.js  
**Frank (heidi-pc):** not reachable from this environment  

Evidence JSON: `artifacts/proof-of-value/evidence/audit-2026-11-16T17-03-01-430Z.json`  
Command: `npm run pov:audit`

## Merged capability (#601–#605, #611)

| PR | Merged | Theme |
|----|--------|-------|
| #601 | yes | Operational supervisor, Frank truth loader, revenue discovery import |
| #602 | yes | Bounded self-improvement loop |
| #603 | yes | Evolution 2.0 (history, scoring, regression, dashboard) |
| #605 | yes | FRANK_VERIFIED wiring, `frank-align-clean-main.ps1` |
| #611 | yes | Jest/babel-register leak fix |

## Capability status matrix

Status legend: **VERIFIED_OPERATIONAL** | **VERIFIED_PARTIAL** | **IMPLEMENTED_UNVERIFIED** | **BROKEN** | **BLOCKED_EXTERNAL** | **NOT_IMPLEMENTED**

| Capability | Status | Evidence |
|------------|--------|----------|
| Repository / clean-main at known SHA | VERIFIED_OPERATIONAL | `git rev-parse HEAD` |
| GitHub CI on clean-main | VERIFIED_PARTIAL | Integration + unit workflows; Pages deploy historically flaky |
| TypeScript strict (`npm run typecheck`) | VERIFIED_OPERATIONAL | Pass on this commit (cloud VM) |
| Next.js heidi-web :3000 | VERIFIED_PARTIAL | HTTP 200 `/api/health`; `status: degraded`, Supabase unset |
| ProtoForge-core :3005 | BROKEN (cloud) | Port closed; required for full pipeline metrics |
| Local Supabase Postgres | BROKEN (cloud) | `npx supabase start` → `DbSetupError`; billing preflight `ECONNREFUSED :54322` |
| Six-layer pipeline (live) | BLOCKED_EXTERNAL | Needs protoforge-core + DB |
| KILO / ProtoForge policy (code) | IMPLEMENTED_UNVERIFIED | Unit/replay tests; not live-probed here |
| heidi-core mission lifecycle | VERIFIED_OPERATIONAL | `mission-worker.test.js` + `hydi-operator-approval-flow.test.js` |
| Heidi Core HTTP service | BLOCKED_EXTERNAL | Not started on cloud VM (boot agent not run) |
| Operational supervisor | VERIFIED_OPERATIONAL | `operational-supervisor.test.js`; live rollup `UNAVAILABLE` without Frank |
| Bounded self-improvement | VERIFIED_OPERATIONAL | Unit tests + `heidi-self-improve.js assess/dashboard` |
| Evolution 2.0 | VERIFIED_PARTIAL | Cloud unit tests; `frank_truth: UNAVAILABLE` on VM |
| Frank production truth collector | BLOCKED_EXTERNAL | Tailscale DNS fails; no `.runtime/production-truth/` LIVE files here |
| Execution fabric / mission bridge | IMPLEMENTED_UNVERIFIED | Code + unit tests; Frank runtime not observed |
| Ollama / local inference | BLOCKED_EXTERNAL | :11434 closed on cloud VM; Frank hosts Ollama |
| Paid LLM | IMPLEMENTED_UNVERIFIED | Gated off (`HYDI_ALLOW_PAID_LLM`); $0 policy |
| Heidi memory (SQLite) | VERIFIED_PARTIAL | Mission tests use temp sqlite; production path on Frank |
| Mobile BFF (`pages/api/heidi-mobile`) | VERIFIED_PARTIAL | Contract unit tests; real phone → Frank backend |
| Device pairing / `HEIDI_MOBILE_TOKEN` | IMPLEMENTED_UNVERIFIED | Auth logic tested; requires Frank tokens |
| Stripe Connect (6 streams) | IMPLEMENTED_UNVERIFIED | Webhook/checkout code; no keys on cloud VM |
| Billing revenue module (slice 1) | VERIFIED_PARTIAL | `acceptance.memory.test.js` pass; PG tier blocked without DB |
| Ursula suite | BLOCKED_EXTERNAL | Separate Python host `localhost:5000` (not on VM) |
| PM2 / Frank auto-deploy | BLOCKED_EXTERNAL | Windows production host only |
| Distributed cloud worker | IMPLEMENTED_UNVERIFIED | Workflow present; not exercised this audit |

## Services on cloud VM (this audit)

| Service | Running? | Notes |
|---------|----------|-------|
| next-server :3000 | yes | Pre-existing dev instance; degraded health |
| next-server :3001 | yes | Secondary instance |
| protoforge-core :3005 | no | Not booted |
| Supabase stack | no | Start failed |
| Ollama | no | |
| hydi-daemon / heidi-core | no | Stale status file referenced in `/api/health` |

## Tests executed (independent)

| Suite | Result | Log |
|-------|--------|-----|
| Core unit (mission, evolution, supervisor, loop) | 53/53 pass | `/opt/cursor/artifacts/pov-core-unit.log` |
| Mobile + Frank loader + operator approval | 61/61 pass | `/opt/cursor/artifacts/pov-mobile-integration.log` |
| `npm run test:pov` | 8/8 pass | `/opt/cursor/artifacts/pov-acceptance.log` |
| `npm run billing:preflight` | fail (expected) | `/opt/cursor/artifacts/billing-preflight.log` |

## Credential / dependency gaps (cloud)

- `SUPABASE_URL` / service role (not loaded — cloud health reports Supabase not configured)
- Postgres :54322 (down)
- `STRIPE_SECRET_KEY` / `BILLING_*` secrets (billing preflight FAIL)
- `HYDI_SERVICE_SECRET` (mobile BFF production)
- Tailscale `TS_AUTHKEY` / `PROTOFORGE_MCP_TOKEN` (Frank read-only MCP)
- Frank operator: PM2, Docker Desktop, Ollama models on heidi-pc