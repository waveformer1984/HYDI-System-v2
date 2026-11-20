# SignalDesk BUILD_STATUS

Last updated: Stage 1 complete (cloud agent run).

## Implemented (Stage 1)

| Area | Status | Evidence |
|------|--------|----------|
| App location | `apps/signaldesk` (isolated from HYDI v2 pipeline) | This tree |
| PostgreSQL schema | Full foundation migration `migrations/001_signaldesk_init.sql` | `npm run db:migrate` |
| Docker Compose | Postgres + Redis (+ optional web/worker profile) | `docker-compose.yml` |
| Next.js shell | Marketing + authenticated app layout, light/dark | `app/`, `components/` |
| Authentication | Auth.js (NextAuth v5) credentials | `lib/auth/`, `app/api/auth/` |
| Registration | Creates user + workspace + owner membership | `app/api/register/route.ts` |
| Workspace isolation | Server-side `requireMembership` | `lib/workspace/access.ts`, integration test |
| Worker stub | BullMQ worker + Redis health | `worker/index.ts` |
| Plans seed | Starter / Studio / Agency in SQL | `plans` table |

## Tested

| Command | When | Result (this environment) |
|---------|------|---------------------------|
| `npm run typecheck` | Stage 1 | **PASS** (cloud agent) |
| `npm test` | Stage 1 | **PASS** 1 unit; integration **skipped** (no `DATABASE_URL` in CI VM) |
| `npm run db:migrate` | Requires Docker Postgres | **NOT RUN** (Docker unavailable in cloud agent VM) |
| `npm run build` | Stage 1 | **PASS** with `AUTH_SECRET` set |

Integration isolation test: run locally after `docker compose up` and `npm run db:migrate`.

## Fixture-only / disconnected

| Integration | State |
|-------------|--------|
| Stripe | Schema only — Stage 3 |
| Business providers | Not wired — Stage 2/4 |
| Ollama | Env hooks only — Stage 5 |
| Email outreach | `SIGNALDESK_EMAIL_ENABLED=false` — disabled |
| Cloud AI | `ENABLE_CLOUD_AI=false` — blocked by config |

## Blocked / needs owner

- Stripe test price IDs and webhook secret in `.env.local`
- Legal review of privacy/terms drafts
- Licensed data provider credentials
- Production deployment approval

## Remaining (Stages 2–6)

1. **Stage 2** — Lead CRUD, CSV, pipeline, demo fictional businesses  
2. **Stage 3** — Stripe Checkout, portal, webhooks, quotas  
3. **Stage 4** — Secure research jobs, evidence, providers  
4. **Stage 5** — Ollama briefs, outreach drafts  
5. **Stage 6** — Analytics, admin health, Playwright E2E, deployment docs  

## Assumptions documented

- Default market example: Austin, TX in onboarding profile JSON.  
- `SIGNALDESK_MODE=test` (Stripe test mode intended; not live).  
- Auth: email/password credentials for local dev (no OAuth providers yet).  
- HYDI monorepo root is unchanged; SignalDesk does not violate six-layer pipeline rules.