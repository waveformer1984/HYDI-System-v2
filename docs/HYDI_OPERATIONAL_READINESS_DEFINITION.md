# HYDI Operational Readiness Definition

## Purpose

This document defines three distinct readiness levels so they are not confused:

- **A. LOCAL-FIRST OPERATIONAL READY** — HYDI runs from local persistence, independent of the cloud Supabase project.
- **B. PRODUCTION READY** — HYDI is safe, observable, resilient, and deployable to a production environment.
- **C. FULL ECOSYSTEM READY** — HYDI plus cloud/remote/optional integrations are fully qualified.

---

## A. LOCAL-FIRST OPERATIONAL READY

Local-first ready means HYDI can start, operate, recover, and shut down using only the local Supabase/Postgres stack and persistent local storage. Cloud Supabase is optional and can be entirely unavailable.

### Acceptance criteria

1. `HYDI_PERSISTENCE_MODE=local` is the default and authoritative mode.
2. `src/persistence/supabase-client.js` factory uses local Supabase by default.
3. `api/health` reports `healthy` with local persistence.
4. `api/ursula/status` reports `OK` with local persistence.
5. Project CRUD works through the local factory.
6. Track CRUD works through the local factory.
7. `system_dashboard` view and `system_health_runs` are queryable/writeable locally.
8. Dashboard collector and bridge upload and retrieve status from local HYDI.
9. Local backup script creates a valid dump.
10. Local restore script restores a valid dump to a disposable database and verifies schema/data.
11. Database stop/start (persistent volume) recovers with no data loss.
12. HYDI process restart reconnects to local persistence.
13. A 1-hour local-first soak with `HYDI_PERSISTENCE_MODE=local` passes with:
    - health, ursula, project/track CRUD, system health, collector exercised
    - one controlled database restart
    - one controlled HYDI restart
    - >= 95% success rate for persistence operations
    - zero cloud traffic
14. Cloud URL is configured as unroutable and is never accessed in local mode.
15. `npm run typecheck` passes.
16. `npm run hydi:readiness` reports `READY`.
17. `npx jest tests/unit/persistence-guard.test.js` passes.
18. No secret values in dashboard, public, tools, artifacts, or backups.
19. No destructive database operations required for normal operation.

### What is intentionally OUT OF SCOPE for local-first

- Real cloud Supabase failover.
- Production deployment pipelines.
- CI/CD green light.
- Multi-machine synchronization.
- Live Stripe real-money transactions.
- 24-hour production soak.

---

## B. PRODUCTION READY

Production ready means the system can be safely deployed to a live environment serving real users and revenue.

### Additional acceptance criteria (on top of local-first)

1. **Authentication and authorization**
   - All API routes enforce ownership boundaries.
   - Service tokens are signed and verified.
   - No hard-coded credentials.
   - `SUPABASE_SERVICE_ROLE_KEY` is never sent to the client.
2. **Secret handling**
   - All secrets are injected at runtime (no `sk_live_`, no `whsec_`, no `sb_secret_` in committed files).
   - `.env` and `.env.local` are not committed; `.env.example` is present and safe.
   - Backup dumps are encrypted or otherwise protected.
3. **Persistence durability**
   - Automated, tested backups with retention.
   - Point-in-time restore verified.
   - Database volume is persistent and replicated if required.
4. **Migrations**
   - Every migration has a corresponding test in `tests/migrations/`.
   - Migrations are idempotent and reversible where possible.
   - No destructive migrations in the active upgrade path.
5. **Observability**
   - Health checks cover all critical services.
   - Metrics and alerts for failure rate, latency, queue depth.
   - Centralized, non-repudiable audit log.
6. **Failure recovery**
   - Process supervision and automatic restart.
   - Database failover (cloud or local replica) tested.
   - Graceful degradation documented and tested.
7. **Docker/container lifecycle**
   - Container health checks.
   - Resource limits (CPU, memory).
   - Graceful shutdown and restart.
8. **API contracts**
   - Vercel API routes documented and versioned.
   - Edge functions JWT enforcement verified.
   - No mixing of `import`/`require` in new modules.
9. **Test coverage**
   - Unit tests pass (including the 2 WSL git-spawn timeouts being understood or fixed).
   - Integration/adversarial tests pass in a live-like environment.
10. **Build and deployment**
   - `next build` passes.
   - Production deploy has pre-flight checks and rollback.
   - CI gates (lint, typecheck, tests, migration checks) pass.
11. **Stripe / revenue**
   - Live keys are not present in repo.
   - Webhook handlers are idempotent and replay-safe.
   - No real-money transactions without explicit confirmation.
12. **Configuration management**
   - Environment-specific config separated.
   - Feature flags for optional cloud behavior.
   - No `NODE_ENV=production` hard-coded in `.env` files.

---

## C. FULL ECOSYSTEM READY

Full ecosystem ready means all optional cloud and third-party integrations are qualified and can be used together.

### Additional acceptance criteria

1. Cloud Supabase project is reachable and can serve as remote backup/synchronization.
2. Cloud failover is tested and audited:
   - Local down / cloud up → cloud
   - Local up / cloud up → local
   - No dual writes
   - No split brain
3. Stripe Connect end-to-end tested in test mode (no live keys required for qualification).
4. Edge functions (Deno) verified in a live Supabase project.
5. Ursula Suite integration verified if used.
6. Ollama / local model can fall back to cloud model if configured.
7. Multi-machine / federation tests pass if applicable.

---

## How to use this definition

1. Certify **A** first.
2. Do not block **A** because **B** or **C** are incomplete.
3. Only move to **B** after **A** is certified.
4. Only move to **C** after **B** is certified.
