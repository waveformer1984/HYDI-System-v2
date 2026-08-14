# Direct Supabase Client Remediation Plan

Date: 2026-08-14
Branch: `release/v0.9.0`

## Inventory method

Searched all `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.ps1`, and `.sh` files for `createClient` or `require('@supabase/supabase-js')` / `import { createClient } from '@supabase/supabase-js'`, excluding `node_modules/`, `.next/`, `out/`, `backups/`, `artifacts/`, and `.git/`.

## Totals

| Category | Count |
|---|---|
| Files with direct Supabase client construction | 259 |
| Estimated `createClient` call sites | ~506 (many files create more than one) |
| Active risk-ranked for production | 99 |

## Classification by directory

| Directory | Files | Likely role | Risk | Notes |
|---|---|---|---|---|
| `api/` | 24 | Server API routes | **P1** | 24 routes create clients. Should use `src/persistence/supabase-client.js` factory. |
| `lib/` | 16 | Shared library code | **P1** | Multiple helpers create clients. Centralize. |
| `workers/` | 18 | Background workers | **P1** | Workers should use canonical factory for persistence. |
| `pages/` | 2 | Next.js pages | **P1** | Page-level client creation. |
| `src/` | 4 | Core modules | **P1** | Includes `src/database.js` (already factory-wired) and others. |
| `supabase/` | 20 | Migrations, seed, functions | **P2** | Edge functions and migration scripts legitimately use direct clients. Edge functions use Deno. |
| `tests/` | 21 | Jest unit/migration tests | **P2** | Tests need isolated clients. Migrate `beforeAll`/test factories to use `src/database.js` where appropriate. |
| `scripts/` | 3 | Operational scripts | **P2** | `verify-supabase.sh`, soak harness, etc. Some are intentionally standalone. |
| `utils/` | 3 | Utilities | **P2** | `utils/supabase/client.ts`, `server.ts`, `middleware.ts`. |
| `heidi-core/` | 7 | Core HEIDI agents | **P2** | Legacy PowerShell/JS. |
| `root/` | 119 | Repo-root scripts, tests, helpers | **P3 / LEGACY** | Many one-off scripts. Likely stale or local-dev only. |
| `archive/` | 4 | Archived implementations | **P3 / LEGACY** | Superseded; no action. |
| `apps/`, `evolution/`, `keeper/`, `revenue-engine/`, `core/`, `modules/`, `templates/`, `hydi-npm/` | ~38 | Various subsystems | **P2/P3** | Review per subsystem. |

## Must-pass-through-factory (P1)

These are the paths where persistence must be routed through `src/persistence/supabase-client.js` for local/cloud/auto correctness:

1. `api/*.js` and `api/*/*.js` (24 files) — runtime API routes.
2. `pages/api/*.js` (already ESM route files, but `api/` is the main set) — 2 files.
3. `lib/` modules that are imported by `api/` or `workers/` (16 files).
4. `workers/*.js` (18 files) — background workers that write to Supabase.
5. `src/database.js` is already canonical. Any other `src/` files (4) should be audited.

Target for first migration phase: **~99 files** (`api/`, `lib/`, `workers/`, `pages/`, `src/`).

## May remain direct (P2/P3)

| Category | Reason |
|---|---|
| `supabase/functions/*` | Edge Functions (Deno) need their own `@supabase/supabase-js` import and JWT. They are not part of the Node factory. They must still not hardcode secrets. |
| `supabase/migrations/` and `tests/migrations/` | SQL is not JS; direct client is for test fixtures. |
| `scripts/local-first-soak.py` | Intentionally standalone test harness. Already fixed. |
| `scripts/verify-supabase.sh` | Diagnostic script. OK if it reads env. |
| `tests/unit/*` | Hermetic unit tests may create mock or test clients. Use factory unless mocking. |
| `archive/` | Do not modify archives. |
| `heidi-core/HEIDI.ps1` | PowerShell; already had service-role scrub. |

## Legacy/Unused candidates

- `root/` contains 119 files with `createClient`. Many are likely one-off `test-*.js`, `check-*.js`, `verify-*.js`, or old scripts. They should be classified before any migration.
- Recommend a **deprecation sweep** rather than a refactor sweep: if a file in `root/` has no imports and is not referenced by `package.json` scripts, move to `archive/` or remove.

## Safe migration candidates (no runtime behavior change)

Files that currently do `const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)` and nothing else can be replaced with `const { getSupabaseClient } = require('../src/persistence/supabase-client')`.

The canonical factory already supports `local`/`cloud`/`auto` and the same env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `*_LOCAL`, `*_CLOUD`). It is a drop-in for server-side modules.

## Risk ranking

| Rank | Priority | Count | Impact |
|---|---|---|---|
| 1 | **P1** | 99 | `api/`, `lib/`, `workers/`, `pages/`, `src/` — runtime persistence. Without factory, local-first cannot be guaranteed for these paths. |
| 2 | P2 | 21 | `tests/` — flakiness and dual-config risk. |
| 3 | P2 | 3 | `scripts/` — operational scripts. |
| 4 | P3 | 119 | `root/` — stale scripts; deprecate first. |
| 5 | P3 | ~20 | `supabase/migrations/`, `archive/` — no action. |

## Recommended phased plan

### Phase 1 — P1 runtime (do before production)

- Migrate `api/*.js` and `api/*/*.js` to `src/persistence/supabase-client.js`.
- Migrate `workers/*.js` to the factory.
- Migrate `lib/` helpers that are not edge-function specific.
- Migrate remaining `src/` non-factory clients.
- Add `tests/unit/persistence-direct-consumer.test.js` that asserts every `api/`, `workers/`, and `lib/` file with `createClient` passes through `src/persistence/supabase-client.js` or is explicitly allow-listed.

### Phase 2 — P2 tests and scripts

- Update unit tests to use `src/database.js` or a test wrapper.
- Make `scripts/verify-supabase.sh` use the factory if it is a Node script.

### Phase 3 — P3 cleanup

- Inventory `root/` for active scripts; archive or delete unused ones.
- Update `docs/HYDI_CURRENT_STATE_MATRIX.md` with migration percentage.

## Stop condition

Do **not** migrate `supabase/functions/` (Deno) or `archive/`.
Do **not** migrate a file unless the audit can demonstrate it runs in the local-first runtime.
Do **not** change `src/persistence/supabase-client.js` or `src/database.js` — they are already canonical.
