# HYDI Production Readiness Report

Date: 2026-08-14
Branch: `release/v0.9.0`

## 1. Executive Summary

Local-first certification is **GO**. The corrected 1-hour soak passed with 870/870 successful operations, 0 failures, database and HYDI restart recovery, and proven cloud isolation.

**Production readiness is NOT READY.** The P0 blocker is confirmed historical exposure of live credentials in Git history (Stripe live key, Stripe webhook secret, Supabase service-role key). These must be rotated before any production deployment. P1 gaps include missing CI build/typecheck/persistence-guard/readiness gates, 259 direct Supabase client files (99 runtime paths need factory migration), no `.env.example`, unverified deployment path, and missing rate-limit/CSRF/rollback evidence.

## 2. Current Architecture

```text
LOCAL HYDI
    ↓
LOCAL PERSISTENCE FACTORY (src/persistence/supabase-client.js)
    ↓
LOCAL SUPABASE / POSTGRES
    ↓
LOCAL PERSISTENT STORAGE

Cloud Supabase: OPTIONAL / INACTIVE
```

Next.js 15.5.22 + Vercel serverless target. Supabase Edge Functions for async work. Stripe Connect for revenue. Local Ollama for model inference.

## 3. Local-First Certification

| Gate | Result |
|---|---|
| 1-hour local-first soak | **PASS** — 870/870 ops, 0 failures |
| DB restart | **PASS** — data survived, ops resumed |
| HYDI restart | **PASS** — health/ursula/CRUD resumed |
| Cloud isolation | **PASS** — `SUPABASE_URL_CLOUD` unroutable |
| `npm run typecheck` | **PASS** |
| Persistence guard | **PASS** |
| `npm run hydi:readiness` | **READY** |
| Backup | **PASS** |
| Restore | **PASS** |
| `npm test` | **2421 passed / 2 WSL git-spawn timeouts / 1 skipped** |

## 4. Security Findings

| # | Finding | Priority |
|---|---|---|
| 1 | Live `sk_live_` Stripe secret key found in Git history (`supabase/functions/.env.production`, commit `8c2f4dc5...`) | **P0** |
| 2 | Live `whsec_` Stripe webhook secret found in Git history (`test-webhook.js`, `supabase/functions/.env.production`, `vercel-sync-analysis.md`) | **P0** |
| 3 | Supabase `sb_secret_` service-role key partial found in Git history (`heidi-core/HEIDI.ps1`, `check-*.js`, `task-*.js`, `test-*.js`, `configure-vault.js`, `setup-vault.js`) | **P0** |
| 4 | Current `.env` and `.env.local` contain live `sk_live_`, `whsec_`, `sb_secret_`, `HYDI_SERVICE_SECRET` | **P1** |
| 5 | No `.env.example` file; no documented secure secret-injection path | **P1** |
| 6 | 259 files construct direct Supabase clients; many in `api/`, `lib/`, `workers/` | **P1** |
| 7 | Build artifact scan found no secret values embedded in `.next/` | **GOOD** |
| 8 | Only `NEXT_PUBLIC_SUPABASE_*` (publishable) in client bundles | **GOOD** |

## 5. Secrets Findings

See `docs/PRODUCTION_SECRETS_AUDIT.md` for the full audit.

Key action: **rotate the compromised Stripe live secret, Stripe webhook secret, and Supabase service-role key immediately. Do not silently alter them in the repository.**

## 6. Build Verification

| Property | Result |
|---|---|
| Command | `npm run build` |
| Duration | 4m24.651s real |
| Result | **PASS** (exit 0) |
| Warnings | ~100 ESLint `any` and `unused vars` warnings; no errors |
| Output | `.next/` produced with 10 static pages, serverless API routes |
| `out/` produced | **No** — `next.config.js` does not set `output: 'export'`. `vercel.modern.json` expects `out/`; mismatch. |
| Build artifact secrets | **None of the current live values found** |

The build succeeds but CI does not gate it.

## 7. CI Status

CI covers unit tests, V3 integration, migration governance, and CodeQL. It does **not** cover full `npm run typecheck`, `npm run build`, persistence guard, `npm run hydi:readiness`, or secret scanning.

See `docs/CI_PRODUCTION_READINESS_AUDIT.md`.

## 8. Deployment Readiness

| Item | Status |
|---|---|
| Deployment target | Vercel (inferred from `vercel.modern.json`) |
| Build command | `npm run build` (verified passes) |
| Output directory | `out/` in `vercel.modern.json`, but Next.js produces `.next/` — **mismatch** |
| Install command | `npm install` (Vercel default) |
| Startup command | Vercel serverless (no `start` needed) |
| Health endpoint | `/api/health` (verified 200) |
| Rollback mechanism | **UNVERIFIED** — no documented Vercel rollback or tag-deploy workflow |
| Database migration mechanism | Supabase CLI / `supabase/migrations/` + `hdi-governance-gate.yml` |
| Production secrets required | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `HYDI_SERVICE_SECRET`, etc. |

Deployment is **UNVERIFIED** because no staging/production deploy has been performed or observed.

## 9. Persistence Architecture

The canonical factory in `src/persistence/supabase-client.js` and `src/database.js` is proven. However, 259 files still create direct Supabase clients. The runtime-risk files (`api/`, `lib/`, `workers/`, `pages/`, `src/`) must migrate to the factory to guarantee local-first behavior in production.

See `docs/DIRECT_SUPABASE_CLIENT_REMEDIATION_PLAN.md`.

## 10. Direct Supabase Client Audit

- **259 files** contain `createClient` or `@supabase/supabase-js` imports.
- **~506 occurrences** estimated.
- **99 files** are high-priority runtime paths (`api/`, `lib/`, `workers/`, `pages/`, `src/`).
- **20 files** in `supabase/` are legitimate Edge Functions/migrations.
- **21 files** in `tests/` are test harnesses.
- **119 files** in `root/` are likely stale scripts that need deprecation review.

## 11. Data Safety

| Item | Status |
|---|---|
| Backup | VERIFIED (`scripts/backup-local-db.sh`) |
| Restore | VERIFIED (`scripts/restore-local-db.sh`) |
| Migration | VERIFIED (governance gate + migration tests) |
| Rollback | **UNVERIFIED** (no runbook, no drill) |
| Data integrity | VERIFIED (soak + restore constraints) |
| Persistent volume | VERIFIED (Docker restart preserved data) |
| DR documentation | **MISSING** |

## 12. Observability

| Item | Status |
|---|---|
| Health endpoint | VERIFIED (`/api/health`) |
| Readiness | VERIFIED (`npm run hydi:readiness`) |
| Structured logging | FUNCTIONAL (`lib/structured-logger.js`) |
| Error reporting | UNVERIFIED |
| Persistence failure visibility | FUNCTIONAL |
| Database connection visibility | PARTIAL |
| Restart visibility | VERIFIED (soak events) |
| Dashboard status | VERIFIED (collector, bridge) |
| Audit trail | VERIFIED (`hydi:readiness` ledger) |

## 13. API Security

| Item | Status |
|---|---|
| Authentication | FUNCTIONAL (bearer/HMAC in dashboard, auth tests exist) |
| Authorization | FUNCTIONAL (RLS + service_role policy) |
| Service-role usage | **PARTIAL / P0** (over-exposed, historical leak) |
| Frontend exposure | GOOD (no server secrets in client bundles) |
| CORS | PARTIAL (no explicit policy) |
| CSRF | UNVERIFIED |
| Request validation | FUNCTIONAL |
| Rate limiting | UNVERIFIED (dep present, coverage unknown) |
| File access | GOOD (`.gitignore`, no build secrets) |
| Command execution | GOOD (GoalExecutor blocks destructive commands) |

## 14. P0 Findings

1. **Historical Git exposure of live `sk_live_` key** — rotate Stripe secret key.
2. **Historical Git exposure of live `whsec_` webhook secret** — rotate webhook secret.
3. **Historical Git exposure of Supabase `sb_secret_` service-role key** — rotate Supabase service-role key.

## 15. P1 Findings

1. No `.env.example` or documented secret injection path.
2. CI does not run `npm run typecheck`, `npm run build`, persistence guard, or readiness.
3. Deployment path is unverified; `vercel.modern.json` output directory mismatch.
4. 99 runtime files still construct direct Supabase clients.
5. Rate limiting not verified on public/Stripe routes.
6. No rollback runbook or DR documentation.
7. `npm test` has 2 unrelated WSL git-spawn timeouts and 1 skipped; should be understood/fixed for CI reliability.

## 16. P2 Findings

1. Structured logger redaction not tested for rotated values.
2. CORS policy not defined.
3. CSRF not explicitly mitigated for state-changing API routes.
4. Request validation not exhaustive.
5. No persistence/connection pool metrics.
6. No central error reporting.

## 17. Deferred/Optional Items

1. Real cloud Supabase failover verification.
2. Multi-machine / federation.
3. 24-hour production soak.
4. Central observability platform (Sentry, Datadog).

## 18. Required Remediation

1. **P0**: Rotate the three compromised credentials in their respective providers.
2. **P1**: Create `.env.example`, add `production-gates.yml` to CI, fix Vercel output mismatch, begin Phase 1 direct-client migration, and verify rate limiting.
3. **P1**: Document rollback and DR runbook; test a restore-based rollback on a disposable database.
4. **P2**: Add CORS, CSRF, request-validation, and logging-redaction tests.

## 19. Verification Plan

1. After rotation, re-run `git log` for the old values to confirm they are not in new history (they will still be in old history; the key is that the provider has revoked them).
2. After CI additions, open a test PR against `clean-main` and confirm all gates pass.
3. After factory migration, re-run `npx jest tests/unit/persistence-guard.test.js` and the 1-hour soak.
4. After deployment config fix, deploy to a Vercel staging project and verify `/api/health`.

## 20. Final Verdict

| Dimension | Verdict |
|---|---|
| **LOCAL-FIRST** | **GO** |
| **LOCAL PERSISTENCE** | **GO** |
| **DASHBOARD/BRIDGE** | **GO** |
| **AUTO MODE** | **VERIFIED (CONTROLLED TEST)** |
| **CLOUD SUPABASE** | **OPTIONAL / INACTIVE** |
| **PRODUCTION READINESS** | **NOT READY** |
| **FULL ECOSYSTEM** | **NOT READY** |

HYDI is local-first certified and functionally capable. It is **not production-ready** because live credentials have been exposed in Git history and several production gates (CI build, deployment verification, direct-client migration, rate limiting, rollback) remain unproven.
