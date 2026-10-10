# HYDI Test Inventory — Agent D (TEST ARCHITECTURE)

Generated: 2026-09-18 · Branch: `clean-main` · Companion data: `tests/TEST_INVENTORY.json` (664 files, machine-readable).

Classification is by **actual behavior** (imports, client construction, ports, env reads, mocks), cross-checked against **execution evidence**: the Phase-12 `tests/TEST_TIERS.json` measurements (env-redirect + socket-guard runs) **plus a fresh tier-1 `npx jest --json` run executed during this audit** — 355 suites: **353 pass / 2 fail**, 4074 tests: 4066 pass / 7 fail / 1 pending-ish.

## Tier definitions

| Tier | Meaning |
|------|---------|
| 1 | Hermetic unit — no network, no real DB, no real model calls; externals mocked |
| 2 | Local integration — touches local services (local postgres, local fs, spawned local processes); no external network |
| 3 | Local service/system — requires running local services (the app itself, PM2, docker) |
| 4 | Qualification — `tests/qualification/**` and similar end-to-end gates |
| 5 | External/live — requires external systems (real Stripe, real cloud APIs, deployed services) |

## Counts

**All 664 files:** tier1=452 · tier2=40 · tier3=57 · tier4=10 · tier5=105
**By runner:** jest-root=367 · jest-tier2=26 · node:test=56 · vitest=11 · other=19 · none=185
**By status:** hermetic=424 · external-dependency=186 · ambiguous=51 · pre-existing-failure=3

### Per-population × tier

| Population | Total | T1 | T2 | T3 | T4 | T5 | Runner / reachability |
|---|---|---|---|---|---|---|---|
| `tests/unit/` | 299 | 283 | 16 | | | | `npm test` (jest-root) / `npm run test:local` (jest-tier2) |
| `tests/migrations/` | 82 | 72 | 10 | | | | same as above |
| `tests/integration/` | 12 | | | 12 | | | `npm run test:integration:jest` |
| `tests/qualification/` | 10 | | | | 10 | | `npm run test:qualification` (npx tsx) |
| `tests/` root scripts | 5 | | | 3 | | 2 | see below |
| `protoforge/packages/*/tests` | 10 | 10 | | | | | `npm run test:packages` (node:test) |
| `protoforge/tests/platform` | 3 | 3 | | | | | `cd protoforge/tests && npm test` |
| `protoforge/*` other (cascade, hydi-gateway, examples, tools, blueprints) | 13 | 9 | 4 | | | | node:test per-package; **blueprints unreachable** |
| `protoforge-applications/*` | 23 | 18 | 5 | | | | node:test per-package |
| `switchboard/` | 8 | 3 | 5 | | | | node:test per-package |
| `apps/ursula-frontend/` | 21 | 11 | | 6 | | 4 | vitest (src/** only); root `test-*.ts` unreachable |
| `supabase/functions/_shared/` | 1 | 1 | | | | | `deno test` only |
| `core/tests/` + `core/test-router.js` | 4 | 4 | | | | | pytest / node script — no npm reach |
| `.claude/` | 1 | 1 | | | | | standalone python — unreachable |
| `archive/` | 3 | 1 | | | | 2 | unreachable (outside testMatch) |
| **Ad-hoc population** (repo root, `scripts/`, `heidi-core/`, `_diag/`, `pages/`, `api/`) | **169** | 36 | | 36 | | 97 | **~all unreachable** by any gate |

## The non-hermetic offenders (measured, not guessed)

The earlier "~3 suites make real Ollama/Postgres/Flask calls" was an undercount. The **measured** non-hermetic population inside the default `npm test` suite is **26 files** (10 migrations + 16 unit), now carved out into `jest.tier2.config.js` and excluded from tier 1 via `tests/TEST_TIERS.json` → `jest.config.js:testPathIgnorePatterns`.

### Postgres offenders (`new Pool/Client({port:54322})` or supabase-js → 54321)

| File | Evidence |
|---|---|
| `tests/unit/bounded-cognitive-loop.test.ts` | L28–29 hardcoded `port:54322, database:'postgres'`; header documents a measured Ollama dependence too |
| `tests/unit/heidi-cognitive-core.test.ts` | L7 comment "run against the local Supabase Postgres (port 54322)"; L23 `port:54322` |
| `tests/unit/heidi-cognitive-core-qualification.test.ts` | L23 same comment; L34 `port:54322` |
| `tests/unit/heidi-cognitive-core-real-qualification.test.ts` | L16–18 requires "Local Supabase running on 127.0.0.1:54322" + `SUPABASE_SERVICE_ROLE_KEY` |
| `tests/unit/heidi-cognitive-loop-qualification.test.ts` | L14–15 imports `createClient` + `Pool`; L25 `port:54322` — hardcodes the port, never reads env |
| `tests/unit/heidi-campaign-loop-qualification.test.ts` | L43 `Pool`; L52–53 `port:54322` |
| `tests/unit/heidi-commercial-workflow-qualification.test.ts` | L47 `Pool`; L56–57 `port:54322` |
| `tests/unit/heidi-real-e2e-qualification.test.ts` | L26 `Pool`; L35–36 `port:54322` |
| `tests/unit/heidi-revenue-campaign-qualification.test.ts` | L28–29 `createClient` + `Pool`; L38 `port:54322` |
| `tests/unit/heidi-self-sufficiency-production-qualification.test.ts` | L36–38 `127.0.0.1:54322 postgres/postgres` |
| `tests/unit/conversation-store-message-lookup.test.ts` | L21 "These run against the real local Postgres"; L25 `import { Pool }` |
| `tests/unit/communication-layer.test.ts` | Transitive: `ConversationStore` (`lib/communication/conversationStore.ts:84–89`) opens `new Pool({port:54322})` at construction |
| `tests/unit/revenue-engine.test.ts` | L12 "direct PostgreSQL access (not PostgREST)" |
| `tests/unit/webhooks-stripe.test.js` | Mocks supabase-js/stripe (L13–32) but a transitive dep still dials a blocked port — failed under the socket guard |
| `tests/migrations/20260819140000_communication_layer_schema.test.js` | L13 `require('pg')`; L17 `PGPORT \|\| '54322'` |
| `tests/migrations/20260819200000.test.js` | L12 `require('pg')`; L16 `port:54322` |
| `tests/migrations/20260915120000–160000 (5 files)` | L5–13 `createClient(SUPABASE_URL \|\| 'http://127.0.0.1:54321')` |
| `tests/migrations/20260915180000.test.js` | L21 `createClient` + `pg` Client |
| `tests/migrations/20260916000000.test.js` / `20260916010000.test.js` | L12–18 `createClient` + `pg` Client against 54321/54322 |

### Ollama offenders (real `localhost:11434`)

| File | Evidence |
|---|---|
| `tests/unit/heidi-self-sufficiency-qualification.test.ts` | L96–97 `createOllamaProbe(process.env.LOCAL_MODEL_URL \|\| 'http://localhost:11434', ...)` — real GET to Ollama API root |
| `tests/unit/heidi-self-sufficiency-production-qualification.test.ts` | L694–695 same `createOllamaProbe` fallback to `localhost:11434` |
| `tests/unit/bounded-cognitive-loop.test.ts` | Header: "Measured on 2026-09-08, Ollama answered…" |

### Flask offender (real `localhost:5000`)

| File | Evidence |
|---|---|
| `tests/unit/proto-yi-diagnostics.test.js` | L51 `http.get('http://localhost:5000/proto_iy/', {timeout:500})` — real GET to the Ursula/Proto-YI Flask service; L59 note "Skipping: Flask Proto YI is running on localhost:5000" |

### Borderline (attempts a blocked port but degrades gracefully → stays tier 1)

- `tests/unit/heidi-continuous-loop-qualification.test.ts` — L42–48 hardcodes `127.0.0.1:54322` **but passed this audit's socket-guard run**: `CognitiveCoreBuilder`/health probes treat ECONNREFUSED as "unhealthy", not a crash. Hermetic-in-outcome; flag for review.
- `tests/TEST_TIERS.json → method.attemptedButHermetic` lists 8 more (3 migrations, 3 hydi-v3, `recovery-bridge`, `ServiceContract`, `SecurityAuditor`, `ActionSnapshot`) that attempt blocked connections yet pass.

## Pre-existing failures (this audit's measured tier-1 run)

| File | Result |
|---|---|
| `tests/unit/capability-acquisition-engine.test.ts` | 6 tests exceed the 30 s timeout — the suite uses **real retry/backoff delays (~14 s each)** with mocked fetch; timing-sensitive/flaky under parallel workers. Tracked, unmodified since Sep 13 — the surviving pre-existing baseline failure. |
| `tests/unit/local-state-backup.test.ts` | 1/9 assertions fail (`manifest.schema`) — **untracked WIP**; sibling `lib/backup/` is also untracked WIP being authored concurrently by another agent. Hermetic by design (tmpdir + injected `pgDump`); failure is app-code WIP, not non-hermeticity. |
| `protoforge/packages/certification/tests/certifier.test.js` | Documented known failure (TEST_TIERS): `certify('rezonate')` returns `ok=false` — real drift between certifier and rezonate manifest, deliberately left red. |

## What the root gate does and does not cover

`npm test` = `cross-env PG_HOST=127.0.0.1 PG_PORT=59999 SUPABASE_URL=http://127.0.0.1:59999 … jest` → `jest.config.js` (tier 1): matches `tests/unit/**` + `tests/migrations/**` + `__tests__/**` minus the 26 tier-2 files; loads `jest.setup.js` (in-memory broker, stubbed env) + `tests/tier1-hermetic-guard.js` (socket-level refusal of ports 3000/3005/3006/5000/5432/6379/11434/54321/54322/54323/54327 for both `net.Socket` and `fetch`).

- **This run measured 355 suites** (381 matching − 26 excluded): 353 pass, 2 fail (above).
- `__tests__/**` is in testMatch but **matches zero files** — no such directory exists.
- The gate is wired into `.githooks/pre-push`, `tools/verify.ps1`, and CI `unit-tests.yml` (the required "Jest Unit Tests" check). CI `integration-tests.yml` separately runs `test:integration:jest` (the 12 tier-3 files).
- **NOT covered by any gate:** all 26 tier-2 files (`npm run test:local` — manual only), the 10 qualification programs (manual), both `tests/hdi-*` suites, all 56 node:test files except via manual `npm run test:packages` / per-package `npm test`, all 11 vitest files, the Deno/pytest files, and the entire ~169-file ad-hoc population.
- `npm run test:all` = `test:unit` + `test:local` → covers tier 1 + tier 2 = 381 suites if both run.

## Unreachable / hidden populations

| Population | Status |
|---|---|
| `tests/qualification/test-*.ts` (10) | `test-` **prefix**, no `.test.` suffix — invisible to jest/node:test by design (they are `main()` programs). Now reachable via `npm run test:qualification` (Phase 12 `scripts/run-qualification-suite.js`). |
| `protoforge/blueprints/application/tests/blueprint.test.js` | **Still unreachable**: node:test format but the directory has no `package.json`, and root `test:packages` only globs `protoforge/packages/*/tests/*`. |
| `tests/hdi-everything-wrong.test.js` | Reachable only via `npx jest --config jest.integration.config.js` — `npm run test:integration` invokes `node` on `hdi-adversarial` alone. |
| `tests/soak-test-24h.js`, `test-all-agents.js`, `test-operations-agent.js` | No npm script references them (`soak-test` → `scripts/soak-test.js`). |
| `apps/ursula-frontend/test-*.ts` (10) | vitest include only matches `*.test.*`/`*.spec.*` — the `test-` prefix files are invisible even inside their own package. |
| `supabase/functions/_shared/security.test.ts` | `deno test` only; tsconfig-excluded, invisible to jest. |
| `core/tests/*.py`, `.claude/…/test_governance.py` | pytest/plain-python; invisible to the JS toolchain. |
| `archive/**` | Outside every testMatch. |
| **~169 ad-hoc scripts** | `test-*`/`test_*`/`*_test`/`*.test.*` named scripts at repo root (~118), `scripts/` (29), `heidi-core/` (12), `_diag/` (2), plus endpoint/page files. Only 3 are reachable: `scripts/soak-test.js` (`npm run soak-test`), `scripts/soak-test-v3.js` (`test:soak:hydi-v3`), `heidi-core/phase-5-stress-test.js` (`stress-test`). Most read `.env` for live `SUPABASE_*`/`STRIPE_*` credentials or hit hardcoded production/local URLs — **97 tier-5, 36 tier-3**. |
| `apps/ursula-frontend/runtime/adversarial-test/` | A separate npm package (`@protoforge/adversarial-test`, `npm test` → `node index.js`) — its entry file is `index.js`, not name-matched as a test. |
| **Not test files (excluded):** `tests/__mocks__/`, `tests/migrations/helpers.js`, `protoforge-applications/rezonate/tests/helpers/service-token.js`, `scripts/minitest.js` (a mini jest-runner tool), `supabase/migrations/*_is_test_mode.sql` (schema file), `pages/api/operations/test-push.js`, `api/webhooks/stripe-test.js`, `pages/test-simple.tsx` (deployed endpoints/pages misnamed as tests — flagged `ambiguous` in the JSON). |

## The protoforge/packages runner story

`protoforge/packages/*/tests/*.test.js` (10 files) use `require('node:test')` but had **no runner at all** before Phase 12 — no package.json, no npm script, invisible to jest (different test format). Root `npm run test:packages` = `node --test protoforge/packages/*/tests/*.test.js` now reaches them. **Not obsolete**: `api/platform/{applications,capabilities,dependencies,events}.js` import this code. One known red: `certifier.test.js` (see above).

The wider `protoforge/` tree (cascade, hydi-gateway, examples, tools, platform tests) plus `protoforge-applications/{rezonate,proto-yi}` and `switchboard/` each carry their own `package.json` with `"test": "node --test tests/**/*.test.js"` — reachable only from inside each directory, never from root. `apps/ursula-frontend` uses vitest 4 (`vitest run`, jsdom, `vi.mock` for externals like `@upstash/redis`).

## Enforcement machinery (Phase 12, verified working this audit)

- `jest.config.js` reads tier-2 membership from `tests/TEST_TIERS.json` — single source of truth for both configs; drift impossible.
- `tests/tier1-hermetic-guard.js` patches `net.Socket.connect` + `global.fetch`, refusing known service ports with a `TIER1_HERMETICITY_VIOLATION` error that names the calling test file. Emits `'error'` async (like real ECONNREFUSED) rather than throwing — a deliberate fix so the guard fails the test, not the jest worker.
- `jest.setup.js` redirects the boot lease, boot-control dir, and recovery-lease dir to `os.tmpdir()` — tests can no longer read the developer's real `.hydi-boot.lock` or write into live control dirs.
- `npm test` itself poisons `SUPABASE_URL`/`OLLAMA_URL`/`PG_*` to closed port 59999 — env-reading non-hermetic tests fail fast; hardcoded-port ones are caught by the socket guard.
