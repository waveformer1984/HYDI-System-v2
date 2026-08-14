# HYDI Production Readiness Matrix

Date: 2026-08-14

## Legend

- **VERIFIED** — implemented, tested, and confirmed working.
- **FUNCTIONAL** — implemented, tests pass, but not fully exercised live.
- **PARTIAL** — implemented, some gaps or missing evidence.
- **UNVERIFIED** — implemented, no evidence captured.
- **BLOCKED** — cannot proceed without another fix.
- **MISSING** — not implemented.
- **OPTIONAL** — not required for the stated scope.

## Matrix

| Capability | Current State | Evidence | Risk | Priority | Required Fix | Verification Method | Status |
|---|---|---|---|---|---|---|---|
| Local-first runtime | VERIFIED | 1-hour soak 870/870 | Low | — | None | Soak artifact 20260814-154104 | GO |
| Local persistence | VERIFIED | persistence-guard, auto-mode tests | Low | — | None | `npx jest tests/unit/persistence-guard.test.js` | GO |
| Database recovery | VERIFIED | DB restart during soak | Low | — | None | Soak events, data-integrity checks | PASS |
| HYDI recovery | VERIFIED | HYDI restart during soak | Low | — | None | Soak events, health resume | PASS |
| Data durability | VERIFIED | backup/restore, soak restarts | Low | — | None | `scripts/backup-local-db.sh`, `scripts/restore-local-db.sh` | PASS |
| Dashboard/bridge | VERIFIED | Collector 80/80 in soak, bridge tests | Low | — | None | Soak metrics, bridge tests | GO |
| Cloud isolation | VERIFIED | unroutable `SUPABASE_URL_CLOUD` | Low | — | None | Soak logs, network evidence | PROVEN |
| Auto mode | VERIFIED (controlled test) | 4-case matrix pass | Low | — | None | `scripts/auto-mode-test.js` | VERIFIED |
| Cloud Supabase | OPTIONAL / INACTIVE | cloud project down | Low | — | None | Configuration | OPTIONAL |
| Secrets management | **UNVERIFIED** | live `sk_live_` in `.env`; P0 historical exposure | **Critical** | **P0** | Rotate compromised keys; create `.env.example`; use runtime injection | `docs/PRODUCTION_SECRETS_AUDIT.md` | **P0** |
| Build verification | **FUNCTIONAL** | `npm run build` passed (4m24s) with warnings | Medium | **P1** | Add build gate to CI; fix or suppress ESLint `any`/unused warnings | `npm run build` | PARTIAL |
| CI/CD | **PARTIAL** | unit + V3 integration present; full typecheck/build/persistence-guard/readiness missing | High | **P1** | Extend `unit-tests.yml` or add `production-gates.yml` | `.github/workflows/` | PARTIAL |
| Deployment readiness | **UNVERIFIED** | `vercel.modern.json` exists; no deploy workflow; `out/` not produced | High | **P1** | Verify Vercel project settings; test deploy path in staging | Vercel dashboard/CLI | UNVERIFIED |
| Direct Supabase clients | **PARTIAL** | factory exists; 259 files still construct clients; runtime paths P1 | High | **P1** | Migrate `api/`, `lib/`, `workers/`, `pages/`, `src/` to factory | `docs/DIRECT_SUPABASE_CLIENT_REMEDIATION_PLAN.md` | PARTIAL |
| Production configuration | **PARTIAL** | `.env`/`.env.local` not committed; no `.env.example`; `next.config.js` exposes `NEXT_PUBLIC_*` correctly | Medium | **P1** | Add `.env.example`; separate dev/local/prod config; secure secret storage | File audit | PARTIAL |
| Health endpoint | VERIFIED | `api/health` returns 200 healthy | Low | — | None | `curl /api/health` | GO |
| Readiness endpoint | VERIFIED | `npm run hydi:readiness` READY | Low | — | None | `npm run hydi:readiness` | GO |
| Structured logging | FUNCTIONAL | `lib/structured-logger.js` exists with redaction; not tested for secrets | Medium | P2 | Test redaction for rotated keys | Unit test + manual | PARTIAL |
| Error reporting | UNVERIFIED | No Sentry/central error sink shown | Low | P3 | Add if required; otherwise document | Review | OPTIONAL |
| Persistence failure visibility | FUNCTIONAL | Health endpoint reflects DB state; no dedicated persistence metrics | Medium | P2 | Add persistence factory metrics | Dashboard + logs | PARTIAL |
| Database connection visibility | FUNCTIONAL | Supabase status in dashboard; no connection pool metrics | Low | P3 | Add pg_stat observability if needed | — | PARTIAL |
| Restart visibility | VERIFIED | Soak captured DB/HYDI restart events | Low | — | None | Soak events | PASS |
| Audit trail | VERIFIED | Audit ledger in `hydi:readiness` | Low | — | None | `npm run hydi:readiness` | GO |
| Backup | VERIFIED | `scripts/backup-local-db.sh` | Low | — | None | Run restore | GO |
| Restore | VERIFIED | `scripts/restore-local-db.sh` | Low | — | None | Test restore | GO |
| Migration procedure | VERIFIED | 73+ migrations, governance gate | Low | — | None | `tests/migrations/*.test.js` | GO |
| Rollback procedure | **UNVERIFIED** | Backup/restore exists; no documented rollback runbook | Medium | P1 | Document rollback steps and test on a tag | Manual drill | UNVERIFIED |
| Persistent volume behavior | VERIFIED | Docker persistent volume; data survived DB stop/start | Low | — | None | Soak DB restart | GO |
| Disaster recovery docs | **UNVERIFIED** | No DR runbook found | Medium | P2 | Create `docs/DISASTER_RECOVERY_RUNBOOK.md` | Doc review | MISSING |
| API authentication | FUNCTIONAL | Bearer/HMAC present; not all routes tested for auth | High | **P1** | Auth coverage test for revenue/Stripe routes | `tests/unit/requireAuth.test.js` + manual | PARTIAL |
| API authorization | FUNCTIONAL | RLS enabled; service_role policy added manually; 506 direct clients complicate | High | **P1** | Migrate to factory; enforce row ownership | Migration plan + tests | PARTIAL |
| Service-role usage | **PARTIAL** | `SUPABASE_SERVICE_ROLE_KEY` used by many files; exposed in history | Critical | **P0** | Rotate; limit to server-side factory; never client-side | Secrets audit + code review | **P0** |
| Frontend exposure | VERIFIED | Only `NEXT_PUBLIC_SUPABASE_*` (anon/publishable) in client bundles; no `sb_secret_` values found | Low | — | None | Build artifact scan | GO |
| CORS | FUNCTIONAL | `next.config.js` does not set CORS; Vercel/headers only | Medium | P2 | Define production CORS policy | Vercel + route review | PARTIAL |
| CSRF | UNVERIFIED | Next.js API routes; no explicit CSRF tokens for non-GET | Medium | P2 | Review state-changing routes | Code review | UNVERIFIED |
| Request validation | FUNCTIONAL | Some tests; not exhaustive | Medium | P2 | Add validation middleware | Tests + manual | PARTIAL |
| Rate limiting | **UNVERIFIED** | `express-rate-limit` in deps; not confirmed active on all routes | High | **P1** | Inventory and verify rate limit on public/Stripe routes | `api/*` review | UNVERIFIED |
| File access | VERIFIED | `backups/`, `artifacts/` gitignored; no secrets in build | Low | — | None | Git status + build scan | GO |
| Command execution boundaries | VERIFIED | GoalExecutor blocks `rm -rf /` and `curl evil.com` in tests | Low | — | None | `tests/unit/goal-executor.test.js` | GO |
| Observability dashboard | FUNCTIONAL | `api/health`, `api/ursula/status`, `system_dashboard` view | Low | P2 | Add persistence metrics | Dashboard | PARTIAL |
| Monitoring/logging | FUNCTIONAL | Structured logger; health monitor CI; no central sink | Low | P3 | Add central sink if required | — | PARTIAL |

## Summary

- **P0 (must fix before any production use):** Rotate compromised secrets; limit service-role exposure.
- **P1 (production readiness):** Build gate in CI, migrate direct Supabase clients in runtime paths, add `.env.example`, verify deployment, add rate limiting and auth coverage, create rollback/DR runbook.
- **P2 (resilience/maintainability):** Logging redaction tests, CORS, CSRF, request validation, persistence metrics, DR documentation.
- **P3 (optional):** Central error reporting, pg_stat observability.
