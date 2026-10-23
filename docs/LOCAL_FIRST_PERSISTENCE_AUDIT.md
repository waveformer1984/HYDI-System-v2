# Local-First Persistence Audit

## Scope

Identify every persistence surface before a local-first migration.

## Executive Summary

- The repository already contains a local Supabase Docker stack (`.env`, `supabase/config.toml`, running containers on `127.0.0.1:54321/54322`).
- The canonical cloud project `akbnfovjdcobifeupvbn` is `INACTIVE` and is the source of the current failures.
- There is no central persistence factory; every module constructs its own `createClient` or imports `src/database.js`.
- `src/database.js` is the closest single point of control for CommonJS modules, but 267 files construct or use `createClient` directly.

## 1. Supabase Client Construction

### 1.1 Singleton / single point of control

- `src/database.js` — singleton CommonJS client. Loaded by `dotenv` from `.env.local` then `.env`.
- `src/hydi-v3/RepositoryManager.js` — `RepositoryManager` with `SupabaseStore`.
- `lib/repository.js` (if present) should be audited; not present in root.

### 1.2 Direct `createClient` usage

`grep` found 267 files with `createClient`. Key runtime files include:

- `src/database.js`
- `memory-engine.js`
- `heidi-core/server.js`
- `api/revenue.js`
- `api/dashboard-status.js`
- `api/ursula/status.js`
- `api/health.js`
- `api/chat/route.js`
- `workers/WorkerOrchestrator.js`
- `workers/QueueManager.js`
- `workers/EventBusWorker.js`
- `workers/SyncWorker.js`
- `lib/orchestrator.ts`
- `lib/jobs/stores/SupabaseJobQueue.ts`
- `lib/health/collectors/database.ts`
- `lib/heidi-memory.ts`
- `lib/agent-metrics.ts`
- `src/server.js`
- `src/memory/HeidiMemorySystem.js`
- `revenue-engine/index.js`
- `revenue-engine/revenue-engine-v2.js`

### 1.3 Supabase Edge Functions

`supabase/functions/**/*.ts` files instantiate `createClient` internally. These are Deno/Supabase-managed and are not in the Node runtime path. They can remain cloud-only or be excluded from the local-first migration unless local Edge Functions are required.

## 2. Supabase URLs

### 2.1 Environment variables

`.env` (base, intended for local):
- `SUPABASE_URL=http://127.0.0.1:54321`
- `SUPABASE_SERVICE_ROLE_KEY=sb_secret_...`

`.env.local` (overrides, currently cloud):
- `NEXT_PUBLIC_SUPABASE_URL=https://akbnfovjdcobifeupvbn.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=eyJ...` (cloud)

`src/database.js` loads `.env.local` first, so the cloud values win for Node processes.

### 2.2 Hardcoded URLs

- `tools/dashboard-status/status_collector.py`: `CLOUD_SUPABASE = "https://akbnfovjdcobifeupvbn.supabase.co"`
- `public/client-dashboard.html`: contains the cloud project URL.
- `supabase/config.toml`: configured for local project `HYDI-System-v2`.

## 3. Service-Role vs Anon/Publishable

- `.env.local`: `SUPABASE_SERVICE_ROLE_KEY` (cloud), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (cloud).
- `.env`: `SUPABASE_SERVICE_ROLE_KEY` (local), `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY` (local).
- `src/database.js` uses `SUPABASE_SERVICE_ROLE_KEY`.
- `utils/supabase/server.ts` and `client.ts` use `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Direct PostgreSQL / pg

- `lib/bootstrap.ts` uses `pg` (`DATABASE_URL` / `POSTGRES_URL`? Needs verification).
- `lib/jobs/stores/SupabaseJobQueue.ts` may have SQL mode.
- `lib/health/collectors/database.ts` may use direct SQL.
- Several `.sql` files in `supabase/migrations/` and root define the schema; they are not currently applied to the local Supabase.

## 5. Repository / Store Interfaces

- `src/hydi-v3/RepositoryManager.js` — the best existing factory; currently selects stores based on `config` but not `HYDI_PERSISTENCE_MODE`.
- `lib/jobs/stores/SupabaseJobQueue.ts` — specific to Supabase.
- `lib/protoforge/policy-engine.js` — direct `supabase.from('policies')`.
- `src/database.js` — singleton, not a factory.

## 6. Migrations and Schema

- `supabase/migrations/` contains ~77 SQL migration files.
- `supabase/heidi-init.sql` is a large combined schema.
- `supabase/config.toml` is already configured for local project.
- Local Docker Supabase is running but schema state is unknown and cannot be reset without `supabase status`/`reset`.

## 7. API Routes Depending on Supabase

Critical routes:
- `api/dashboard-status.js` — `system_dashboard`, `system_health`
- `api/health.js` — `system_dashboard`
- `api/ursula/status.js` — `system_dashboard`, `auto_heal_from_trends` RPC, `infrastructure_health`
- `api/chat/route.js` — `supabase` for agent routing
- `api/revenue.js` — many tables
- `api/stripe-connect-webhook.js` — `supabase` inserts
- `api/mobile-status.js` — `supabase`
- `api/heidi/route.js` — may not use Supabase directly
- `api/local-model.js` — uses Ollama, not Supabase

## 8. Existing Local Supabase Configuration

- `supabase/config.toml`: present.
- `.env`: already has local Supabase URLs/keys.
- Docker: `supabase_*` containers are `Up` and `healthy`.
- No `supabase/migrations` application status confirmed; `supabase status` failed due to `.env` parse error.

## 9. Docker Compose

- Local Supabase is running via Docker Compose (managed by Docker Desktop / native Docker).
- Containers use named volumes; persistent storage is present.
- No `infra/supabase/` directory; the existing setup is the canonical one.

## 10. Environment Variables

Current `.env.local` (cloud override):
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `LOCAL_MODEL_URL`, `LOCAL_MODEL_NAME`, `LOCAL_MODEL_PROVIDER`, `OLLAMA_URL` (non-persistence)

Current `.env` (local):
- `SUPABASE_URL=http://127.0.0.1:54321`
- `SUPABASE_SERVICE_ROLE_KEY=sb_secret_...`
- `SUPABASE_ANON_KEY`
- `STRIPE_*` keys (live)

No `HYDI_PERSISTENCE_MODE` or equivalent exists.

## 11. Findings

1. The repository already has a local Supabase stack; the blocker is that `.env.local` overrides with cloud values.
2. `src/database.js` is the only common singleton, but it does not support mode switching.
3. 267 direct `createClient` call sites means a full local-first migration cannot be done at one choke point.
4. Schema exists in migrations but is not guaranteed to be applied to the running local stack.
5. Many API routes use `supabase.from(...)` directly with the global singleton; they will work locally if the singleton points to the local instance and the schema matches.

## 12. Recommended Single Point of Control

Introduce `lib/persistence/factory.js` (or update `src/database.js`) that:

- Reads `HYDI_PERSISTENCE_MODE`.
- For `local`/`auto` when cloud fails, selects local `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Exports the same `supabase` singleton.
- Logs which persistence target is active.

Then update only the Node runtime entry points to use it; Edge Functions are a separate scope.
