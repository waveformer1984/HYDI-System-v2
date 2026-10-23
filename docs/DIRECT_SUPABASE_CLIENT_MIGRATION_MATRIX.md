# Direct Supabase Client Migration Matrix

## Summary

- Total files referencing `createClient` in the repository: **269**
- This includes JavaScript/TypeScript sources, tests, scripts, one-off tools, `.md` files, and HTML artifacts.
- The canonical persistence factory is `src/persistence/supabase-client.js`.
- `src/database.js` is the only CommonJS singleton that consumes the factory.

## Classification

| Category | Count | Description | Disposition |
|---|---|---|---|
| CORE runtime | 12 | `src/database.js`, `api/health.js`, `api/ursula/status.js`, `api/dashboard-status.js`, `api/rezonate/route.js`, `lib/orchestrator.ts`, `src/hydi-v3/RepositoryManager.js`, `lib/jobs/stores/SupabaseJobQueue.ts`, `memory-engine.js`, `heidi-core/server.js`, `revenue-engine/index.js`, `revenue-engine/revenue-engine-v2.js` | Must migrate to `src/persistence/supabase-client.js` or `src/database.js` |
| API routes | ~30 | `api/*.js` routes using direct `createClient` | Migrate via environment (`.env.local` local) and then to factory |
| Workers | ~20 | `workers/*.js` polling Supabase for queues/state | Migrate in batches after core |
| Library modules | ~40 | `lib/**/*.ts/js` repositories and services | Migrate in batches |
| Tests | ~25 | `tests/unit/**/*.test.js`, `tests/hdi-*.test.js` | Keep direct clients for isolated unit tests; use factory for integration tests |
| Tooling / one-off scripts | ~80 | `verify-*.js`, `check-*.js`, `apply-*.js`, `quick-*.js`, `seed-*.js`, `setup-*.js` | Legacy/infrastructure; classify individually |
| Supabase Edge Functions | 42 | `supabase/functions/**/*.ts` | Cloud-only Deno; not in Node runtime path. Do not migrate for local-first |
| Documentation / HTML / markdown | ~10 | `*.md`, `*.html` | No code to migrate |
| Ursula-frontend | ~5 | `apps/ursula-frontend/**` | Separate Flask/Vue app; out of scope |
| Unknown / dead | ~10 | Files that may be superseded or unused | Audit before migration |

## Critical remaining direct callers

The highest-priority remaining callers (not yet routed through the factory) are:

- `api/health.js` — uses `process.env.SUPABASE_URL` directly
- `api/ursula/status.js` — uses `process.env.SUPABASE_URL` directly
- `api/dashboard-status.js` — uses `process.env.SUPABASE_URL` directly
- `api/rezonate/route.js` — uses `process.env.SUPABASE_URL` directly
- `api/revenue.js` — uses `process.env.SUPABASE_URL` directly
- `api/chat/route.js` — uses `process.env.SUPABASE_URL` directly
- `src/database.js` — now uses the factory
- `memory-engine.js` — direct client
- `heidi-core/server.js` — direct client
- `workers/WorkerOrchestrator.js` — direct client
- `workers/QueueManager.js` — direct client
- `workers/EventBusWorker.js` — direct client
- `lib/orchestrator.ts` — direct client
- `lib/jobs/stores/SupabaseJobQueue.ts` — direct client

## Migration priority

1. **Core** — `src/database.js` (done), `api/health`, `api/ursula/status`, `api/dashboard-status` (work via `.env.local` to local).
2. **Active application** — `api/rezonate/route`, `api/revenue`, `api/chat/route`, `lib/orchestrator`, `lib/ModelManager`, `memory-engine`, `heidi-core/server`.
3. **Status/health** — `lib/health/collectors/*`, `true-system-health.js`, `system-status-report.js`.
4. **Workers** — `workers/*`.
5. **Tooling** — `verify-*.js`, `check-*.js`, `quick-*.js`.
6. **Tests** — migrate only where they are integration tests against live persistence.
7. **Edge Functions** — no migration required for local-first Node runtime.

## Recommended next steps

- Migrate one file at a time.
- Replace `createClient(...)` with `require('../../../src/database').supabase` (CJS) or import the singleton (ESM).
- After each batch: `npm run typecheck`, `npm test`.
- Do not mass-edit all 269 files in a single commit.
