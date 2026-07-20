# AGENTS.md

Guidelines for AI agents (Claude Code, Codex, Cursor, etc.) working autonomously in this repository. For comprehensive architecture reference, see `CLAUDE.md`. For prescriptive Cursor IDE rules, see `.cursorrules`.

## Orientation

HYDI System v2 is a Next.js + Supabase AI orchestration platform. Events flow through a strict six-layer pipeline; Stripe Connect manages six revenue streams; 42 Deno Edge Functions handle async work. The primary branch is **`clean-main`** — not `main`. CI runs against `clean-main`.

## Setup

```bash
npm install          # Node >= 20 required
# Environment variables — no .env.example; see CLAUDE.md "Environment Variables" section
# Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, NODE_ENV
```

## Verification — Run These Before Finishing Any Task

```bash
npm run typecheck              # TypeScript type-check — must pass clean
npm test                       # Jest unit tests (tests/unit/)
./verify-supabase.sh           # health check — Supabase connectivity + key tables
```

Integration tests require live env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) — do not run in a cold environment:

```bash
npm run test:integration       # adversarial + chaos tests — needs live Supabase
```

Run a single test file:
```bash
npx jest tests/unit/heidi-core-loop.test.js
npx jest --testNamePattern="should classify events"
```

## Navigating the Codebase

| What you need | Where to look |
|--------------|---------------|
| API routes | `api/` — Vercel serverless functions |
| Event pipeline layers | `cascade/` (layer 3), `kilo/` (layer 4), `lib/protoforge/` (layer 5) |
| Supabase Edge Functions | `supabase/functions/<name>/index.ts` |
| DB schema & migrations | `supabase/migrations/` (numbered + timestamped) |
| Background workers | `workers/` (18 workers, all supervised by `WorkerOrchestrator.js`) |
| PAO agents | `pao-system/agents/`, `pao-system/core/` |
| Frontend pages | `pages/` (Next.js) |
| React components | `components/` |
| Revenue pipeline | `revenue-engine/` |
| KILO hypothesis generator | `kilo/index.js` |
| DSL policy engine | `lib/protoforge/policy-engine.js` |
| Test files | `tests/unit/` (unit), `tests/migrations/` (one per SQL migration) |

## Hard Constraints — Never Violate

### Six-Layer Pipeline

```
[1] Ingestion    → normalise structure only
[2] RAW LEDGER   → append-only, immutable, hashed
[3] CASCADE      → classify events only
[4] KILO         → generate hypotheses only — NEVER execute
[5] ProtoForge   → policy gate, accepts/rejects KILO output
[6] Emission     → SSE/API/logs — no logic here
```

- **KILO (`kilo/index.js`) must never execute actions.** `execute()` throws unconditionally by design. Only call `generateHypotheses()`.
- **Emission layer** (layer 6) must remain logic-free. Do not add conditionals or state mutations there.
- **No layer may perform another's job.** Classification belongs in CASCADE, not KILO; enforcement belongs in ProtoForge, not Emission.

### PolicyEngine

- `lib/protoforge/policy-engine.js` is **fail-closed**: default decision is `'reject'` when no rule matches. Do not change this default.
- DSL operators: `gte`, `lte`, `gt`, `lt`, `eq`, `neq`, `in`, `nin`, `contains`, `startsWith`, `regex` — do not invent new operators; add them to the DSL loader instead. Multi-condition grouping via reserved `all`/`any` condition keys (arrays of nested conditions).
- Rules live in Supabase (`policies` table) and hot-reload via Realtime — do not hardcode rules in application code.

### Cooldown Windows

Both windows are mandatory — do not remove or shorten them:
- **Startup window**: 2 minutes after boot with no enforcement
- **Drift observation**: 30 seconds before alerts fire

### Workers

- Every new worker **must be registered in `workers/WorkerOrchestrator.js`** before deploying. Omitting registration causes a startup crash.
- `DecisionAssistWorker.js` requires `QueueManager` — do not instantiate it without providing a queue manager instance.

### Database Migrations

- Every new `.sql` file in `supabase/migrations/` requires a corresponding test in `tests/migrations/<version>.test.js`.
- State machine changes (enum values, allowed state transitions) require `STATE_MACHINE_APPROVED` in the PR description.
- Files ending `.sql.skip` are intentionally excluded from the migration runner — do not run them.
- RLS is enabled on all tables — never disable it.
- Pin `search_path` on all `SECURITY DEFINER` functions to prevent SQL injection.
- PRs touching `supabase/migrations/**` trigger the **`hdi-governance-gate.yml`** 7-gate CI review: change detection → transformer tests → state machine approval → adversarial tests → replay fidelity → performance regression → blueprint sync. All seven gates must pass.

### `api/mobile-status.js`

Must remain a single round-trip returning exactly `{ ok, alert, system, drift, heals_24h, streams, silent, ms, ts }`. Do not add latency or extra DB calls.

### `system_dashboard` Supabase View

Drives all health endpoints. If this view is broken, endpoints return 503. Do not try to work around it — fix the view.

## Module Style

| Location | Style |
|----------|-------|
| `api/*.js` | ESM — `export default async function handler(req, res)` |
| `kilo/index.js` | CommonJS — `module.exports = { KiloEngine, createKiloEngine }` |
| `supabase/functions/*/index.ts` | Pure ESM (Deno) — never use `require` |
| `pao-system/**/*.ts` | TypeScript strict mode |

Be consistent within a file. Do not mix `import` and `require` in new code.

## TypeScript Rules

- Strict mode — `next.config.js` does **not** suppress TS/ESLint errors.
- Catch variables are `unknown` — always guard: `error instanceof Error ? error.message : 'Unknown error'`
- Run `npm run typecheck` before every commit.

## Secret Handling

Per `SECURITY_PROTOCOL.md` — never display, echo, log, or paste secrets:

```bash
# Correct: pipe directly into the destination
node -e "require('crypto').randomBytes(32).toString('hex')" | vercel env add SECRET_NAME

# Verify presence only — never reveal value
vercel env ls | grep SECRET_NAME
```

`SUPABASE_SERVICE_ROLE_KEY` is server-side only — never expose to the client.

## RFC / Significant Changes

Before implementing a change that touches the six-layer pipeline boundary, the PolicyEngine DSL, the `system_dashboard` view schema, Supabase Edge Function JWT config, or any PAO agent public API, open a GitHub Issue with the `rfc` label first. See [GOVERNANCE.md](GOVERNANCE.md) for the RFC process.

Pipeline boundary bugs should be filed using the **`pipeline-violation`** issue template (`.github/ISSUE_TEMPLATE/pipeline-violation.md`), not the generic bug template.

## What Not To Do

- Do not give KILO execution authority — `execute()` must keep throwing.
- Do not change PolicyEngine's default from `'reject'` to anything permissive.
- Do not add logic to the Emission Layer.
- Do not skip cooldown windows.
- Do not add a new worker without registering it in `WorkerOrchestrator.js`.
- Do not add a SQL migration without a corresponding test in `tests/migrations/`.
- Do not run `.sql.skip` migrations.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- Do not push to `main` — the primary branch is `clean-main`.
- Do not rename `pao-system/services/nnotification.service.ts` until all imports are updated together.
- Do not add latency to `api/mobile-status.js`.

## Key Documentation

| Doc | Purpose |
|-----|---------|
| [CLAUDE.md](CLAUDE.md) | Full architecture, module reference, commands, and conventions |
| [AGENTS.md](AGENTS.md) | This file — agent quick-reference |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branch strategy, test commands, PR requirements |
| [GOVERNANCE.md](GOVERNANCE.md) | RFC process, migration gate policy |
| [SECURITY_PROTOCOL.md](SECURITY_PROTOCOL.md) | Secret handling protocol |
