# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This System Does

HYDI System v2 (also called "Heidi" / "ProtoForge → Kilo Node") is a monetizable AI orchestration platform. It turns ProtoForge into an executable revenue-generating system by:

- Running a deterministic event pipeline (CASCADE → KILO → ProtoForge) over an immutable RAW EVENT LEDGER
- Managing multi-revenue-stream billing via Stripe Connect with per-project sub-accounts
- Hosting a Next.js frontend with Vercel serverless API routes
- Offloading async work to 42 Supabase Edge Functions (Deno)
- Coordinating hardware/HID agents (Python) for physical device automation

The six active revenue streams routed through Stripe Connect are: `galactic_bytes`, `detailer_bot`, `lipi_v2`, `protogrance_aromatics`, `rezonate`, and `waveformer_studio`.

## Commands

```bash
npm install          # Install dependencies (Node >= 20 required)
npm run dev          # Next.js dev server on 0.0.0.0:3000
npm run build        # Production build
npm start            # Start production server
npm run typecheck    # TypeScript type-check (tsc --noEmit, no emit)
npm test             # Run Jest unit tests
npm run test:watch   # Jest in watch mode
npm run test:coverage  # Jest with coverage report
npm run test:integration  # Run adversarial integration tests (tests/hdi-adversarial.test.js)
```

Operational scripts at the repo root:
```bash
./verify-supabase.sh       # Health check: verifies Supabase connectivity and key tables
./deploy-production-safe.sh  # Safe production deploy with pre-flight checks
./setup.sh                 # First-time environment setup
```

Run a single test file:
```bash
npx jest tests/unit/heidi-core-loop.test.js
npx jest tests/unit/stripe-webhook.test.js --verbose
```

Run a single test by name:
```bash
npx jest --testNamePattern="should classify events"
```

## Architecture

### The Core Pipeline (HEIDI V2 Single Truth Architecture)

Every event flows through exactly six layers, in order, with **no layer performing another's job**:

```
[1] Ingestion Layer    → normalizes structure only, no interpretation
[2] RAW EVENT LEDGER   → append-only, immutable, hashed — the single source of truth
[3] CASCADE            → classifies events, outputs { classification, confidence, matched_rules }
[4] KILO               → generates hypotheses only, never executes — { hypotheses, suggested_fixes }
[5] ProtoForge         → policy engine, accepts/rejects KILO suggestions
[6] Emission Layer     → SSE / API / logs, no logic
```

A Replay Engine sits outside this pipeline and validates determinism: same RAW LEDGER input must produce the same pipeline output. Divergence == real drift. See `HEIDI_V2_ARCHITECTURE.md` and `GROUNDED_ARCHITECTURE.md` for full detail.

### Key Architectural Constraint

The original system (V1) built enforcement before establishing ground truth, causing false positives and feedback loops. V2 inverts this: **truth is anchored first (RAW LEDGER), then enforcement layers run on top**. Two cooldown windows enforce this:
- **Startup window**: 2 minutes — no enforcement
- **Drift observation**: 30 seconds before alerts fire

### Named Agents / Subsystems

| Name | Role | Entry point |
|------|------|-------------|
| **Heidi** | Conversational orchestrator, task management | `api/heidi/route.js` |
| **Ursula** | System monitor / status interface | `api/ursula/status.js`, `api/chat/route.js` |
| **CASCADE** | Event classifier (classification only) | Routed via `api/chat/route.js` |
| **KILO** | Hypothesis generator (no execution authority) | Routed via `api/chat/route.js` |
| **ProtoForge** | Policy engine / governance layer | Routed via `api/chat/route.js` |
| **Hyve** | Opportunity collective / swarm intelligence | Routed via `api/chat/route.js` |

### PAO System Agents (`pao-system/`)

The PAO (Personal AI Orchestration) subsystem contains TypeScript agents that run under strict mode:

**Core** (`pao-system/core/`):

| File | Role |
|------|------|
| `heidi.controller.ts` | Central orchestrator — `taskRoutingMatrix: Map<string, string[]>`, emits events, manages session state |
| `agent.registry.ts` | Agent registration and discovery |
| `approval.engine.ts` | Action approval workflow |
| `ethical-decision-engine.ts` | Ethical guardrails for agent decisions |
| `event.bus.ts` | Internal event pub/sub |
| `risk.engine.ts` | Risk scoring for proposed actions |
| `task.router.ts` | Routes tasks to the correct agent |

**Agents** (`pao-system/agents/`):

Business: `revenue.agent.ts`, `funding.agent.ts` (uses `.getTime()` for Date arithmetic), `finance.agent.ts`
Operations: `facility.agent.ts`, `security.agent.ts`, `workflow.agent.ts`, `procurement.agent.ts`
Outreach: `community.agent.ts`, `marketing.agent.ts`, `outreach.agent.ts`
Execution: `construction.agent.ts`, `fabrication.agent.ts`
Strategic: `ai.agent.ts`, `architect.agent.ts`, `energy.agent.ts`

**Services** (`pao-system/services/`): `llm.service.ts`, `storage.service.ts`, `notification.service.ts`, `nnotification.service.ts` (double-`n` typo — do not rename until all imports updated)

**Integrations** (`pao-system/integrations/`): `email.ts`, `grants.api.ts`, `stripe.ts`

**Schemas** (`pao-system/schemas/`): `event.schema.ts`, `finance.schema.ts`, `task.schema.ts`

**Knowledge base** (`pao-system/knowledge/`): Markdown files covering agent-prompts, cultural-tone, ethos-mission, integration-rules, public-mission, unified-cognitive-layer

All PAO agents use shared types from `types/index.ts` (`SessionState`, `SystemStatus`, `ModelStatus`, `ActionLog`, `ActionItem`). Catch variables are typed `unknown` — always guard with `error instanceof Error ? error.message : 'Unknown error'`.

### API Layer (`api/`)

All files under `api/` are **Vercel serverless functions** (Next.js API routes). They use ES module `export default async function handler(req, res)` style. Note: some files mix `import` and `require` — be consistent within a file.

| Route | Purpose |
|-------|----------|
| `api/chat/route.js` | Universal chat router — dispatches `{ message, system }` to the correct named agent |
| `api/health.js` | Reads the `system_dashboard` Supabase view for live health metrics |
| `api/heidi/route.js` | Heidi-specific orchestration endpoint |
| `api/hydi/sync.js` | HYDI state sync |
| `api/ursula/status.js` | Ursula system status |
| `api/mobile-status.js` | Compact, 3G-safe system snapshot: health + per-stream revenue in a single round-trip |
| `api/life-flow/route.js` | Life-flow module |
| `api/events/stream.js` | SSE stream for real-time events |
| `api/revenue.js` | Revenue engine: leads, quotes, proposals, Stripe checkout, reports |
| `api/client-dashboard.js` | Per-project ledger view with fee breakdown |
| `api/checkout.js` / `api/checkout-v2.js` | Stripe Checkout session creation |
| `api/stripe-connect-webhook.js` | Main Stripe Connect webhook — routes payments to sub-accounts, writes ledger entries |
| `api/webhooks/stripe.js` | Standard Stripe webhook handler |
| `api/local-model.js` | Local model inference integration |

### Supabase Edge Functions (`supabase/functions/`)

42 Deno-based Edge Functions handle async work. JWT enforcement is configured per-function in `supabase/config.toml`.

**Task workers**: `action-worker`, `agent-worker`, `tool-executor`, `chat-operator`, `jobs-processor`

**Billing pipeline**: `billing-engine`, `billing-retry-worker`, `payment-processing`, `payment-processor`, `stripe-webhook`, `stripe-connect-admin`, `stripe-transfer-payout`, `stripe-worker`, `monthly-payout-calculation`

**Auth / access**: `keymaker-gate`, `keeper-break-glass`, `keeper-break-glass-simple`

**Heidi / transitions**: `heidi-reflect`, `hydi-transition`

**Revenue operations**: `revenue-tracker`, `usage-monitor`, `invoice-generator`, `subscription-manager`, `rezonate-engine`

**Observability**: `monitoring-health`, `chaos-runner`, `analytics-service`, `stream-health-watchdog`

**Public services (no JWT)**: `api-gateway`, `notification-service`, `search-service`, `cache-service`, `events-stream`, `file-storage`, `user-management`

**Marketing suite (no JWT)**: `brand-awareness`, `campaign-analytics`, `content-management`, `customer-segments`, `email-marketing`, `lead-generation`, `marketing-automation`, `social-media`

The `stripe-webhook` and `heidi-reflect` functions are also public.

### Frontend (`pages/`, `components/`, `hooks/`)

Next.js pages under `pages/`:
- `pages/index.tsx` — main dashboard
- `pages/agent-manager.tsx` — agent management UI
- `pages/funding.tsx` — funding pipeline view
- `pages/song-composer.tsx` — Rezonate music composer integration
- `pages/trace-viewer.jsx` / `pages/traces.jsx` — event trace inspection

React components under `components/`:
- `AgentBoard.tsx`, `AgentCard.tsx` — agent status and management
- `TaskCreateModal.tsx`, `TaskQueue.tsx` — task pipeline UI
- `components/funding/` — funding-specific components
- `components/song-composer/` — song composer components

The Heidi chat interface itself is a self-contained component directly in `pages/index.tsx` (not `components/`) — it POSTs `/api/chat` and parses the SSE response itself, with no separate hook.

### Revenue Engine (`revenue-engine/`)

Revenue pipeline module separate from the API layer:
- `revenue-engine/index.js` — entry point
- `revenue-engine/revenue-engine-v2.js` — v2 engine with enhanced logic
- `revenue-engine/reality-filter.js` — filters unrealistic revenue projections
- `revenue-engine/schema.sql` / `revenue-engine/outcome-schema.sql` — local schema definitions
- `revenue-engine/modules/` — sub-modules

### KILO Module (`kilo/`)

Standalone implementation of the KILO hypothesis generator:
- `kilo/index.js` — entry point; exports `{ KiloEngine, createKiloEngine }` (CommonJS). `execute()` throws unconditionally — KILO never runs actions directly; only `generateHypotheses()` is permitted.
- `kilo/modules/repair-manifest-validator.js` — validates repair manifests before KILO processes them
- `kilo/modules/truth-filter-gate.js` — gates hypotheses against ground truth before emission

### DSL Policy Engine (`lib/protoforge/`)

Implements ProtoForge's policy layer (pipeline layer [5]) with a runtime-configurable rule DSL:

- `lib/protoforge/policy-engine.js` — evaluates KILO hypotheses against priority-ordered rules loaded from Supabase. DSL operators: `gte`, `lte`, `gt`, `lt`, `eq`, `neq`, `in`, `nin`. Fail-closed: default decision is `'reject'`. Decisions: `'approve' | 'reject' | 'escalate'`. Hot-reloads rule changes via Supabase Realtime — no restart required.
- `lib/protoforge/auto-gate.js` — automatic wrapper that runs PolicyEngine on every KILO output before it reaches the Emission Layer.
- `supabase/functions/protoforge-calibration/` — Edge Function running the calibration feedback loop; adjusts rule weights based on actual outcomes via the `calibrate_protoforge_decisions()` RPC.
- DB tables: `policies` (rules), `decisions` (audit log).

### Hyve Service (`hyve_service/`)

The Hyve opportunity-collective service implementation (Python):
- `hyve_service/listener.py` — listens for opportunity signals
- `hyve_service/outputs/` — processed output directory
- `hyve_service/revenue_ready/` — revenue-ready configuration state

### Workers (`workers/`)

Background workers that poll Supabase and process queue items independently of the API layer:

- **`workers/DecisionAssistWorker.js`** — polls for decision-assist tasks; scores financial_planning, resource_allocation, risk_assessment, and system_optimization requests against configurable confidence thresholds before emitting recommendations. Requires `QueueManager`.
- **`workers/WorkerOrchestrator.js`** — spawns and supervises all workers; `DecisionAssistWorker` must be registered here or the orchestrator will crash on startup.

If you add a new worker, register it in `WorkerOrchestrator.js` before deploying.

### Agents (`agents/`)

- **`agents/specialized/agent-factory.js`** — factory that creates typed business and execution agents
- **`agents/specialized/business-agents.js`** — business domain agents (large, ~70KB)
- **`agents/specialized/execution-agents.js`** — execution domain agents (~54KB)
- **`agents/hid/`** — JavaScript key-rotation agent and secure key setup (PowerShell + JS)
- **`agents/hardware-controller/`** — Python agents for physical hardware: USB HID controller, screen vision, Stripe/Vercel UI navigation via pyautogui/vision, safety orchestrator

### Ursula Suite (Local)

The Ursula EPM Service Suite is a companion Flask server (`C:\ProtoForge_Ecosystem\Ursula_Suite\`) running at `http://localhost:5000`. It is a separate Python codebase — not deployed to Vercel. It hosts five apps:

| App | Blueprint prefix | Description |
|-----|-----------------|-------------|
| Proto.I.Y | `/proto_iy` | Projects & Timelines |
| BlameGames | `/blame_games` | Betting & Challenges |
| PorchWise | `/porch_wise` | Family Management |
| Rezonette | `/rezonette` | Music Production |
| **Checkpoint** | `/checkpoint` | QA & Risk Analysis |

The Checkpoint app (`apps/checkpoint/`) provides risk-scored workflow analysis:
- `checkpoint_qa.py` — QA engine with SQLite backend, risk scoring, failure point detection, auto-checkpoint creation
- `routes.py` — Flask Blueprint using `importlib.util.spec_from_file_location` for bulletproof module loading
- Test suite: `ursula-suite/checkpoint/tests/phase2_test_suite.ps1`
- Dashboard: `ursula-suite/checkpoint/dashboard/dashboard.html`

### Database (`supabase/`)

Schema is managed via numbered migrations in `supabase/migrations/`. Files ending in `.sql.skip` are intentionally excluded from the migration runner. The Supabase project ref is `akbnfovjdcobifeupvbn`.

Core tables (from `supabase/heidi-init.sql` and migrations):
- **`memories`** — vector embeddings (1536-dim, `pgvector`) scoped by `user_id` / `session_id`
- **`actions`** — task action log with `pending` / `completed` / `failed` status
- **`sessions`** — session state (tone, active model, last action)
- **`ledger`** — immutable financial ledger: gross amount, fee breakdown (platform 5%, agent 10%, Stripe 2.9% + $0.30), net, payout status
- **`clients`** / **`payouts`** — client registry and payout batches
- **`leads`** / **`quotes`** / **`proposals`** / **`checkout_sessions`** — revenue pipeline tables

Key DB features: RLS enabled on all tables, `system_dashboard` view drives health endpoints, `pg_cron` schedules billing retry and monthly payout calculation, RPC functions for tool execution and auto-healing.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |
| `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL exposed to client |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET_01` | Stripe webhook signing secret |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Stripe Connect webhook signing secret |
| `STRIPE_ACCOUNT_GALACTIC_BYTES` et al. | Connect sub-account IDs per revenue stream |
| `WEBHOOK_PROCESSING_ENABLED` | Incident kill switch for `api/webhooks/stripe.js`. Unset/anything other than the literal string `'false'` means processing is ON — only an explicit `'false'` pauses it. Not provisioned by default. |
| `JWT_SECRET` | Signs/verifies tokens in `workers/SecurityIdentityWorker.js` and `keeper/index.js`. Required — both fail closed (refuse to start / throw) rather than falling back to a hardcoded secret. |
| `NODE_ENV` | `production` / `development` |
| `ANTHROPIC_API_KEY` | Enables the native streaming/tool-calling agent (`lib/heidi-agent.ts`); when unset Heidi uses the fallback orchestrator |
| `ANTHROPIC_BASE_URL` | Optional override of the Anthropic SDK base URL (e.g. a compatible proxy) |
| `OPENAI_API_KEY` | Hosted memory embeddings (1536-dim) |
| `EMBEDDING_PROVIDER` | `openai` \| `ollama` — forces the embeddings backend; auto-selected otherwise (OpenAI if its key is set, else Ollama when a local model is enabled) |
| `OLLAMA_EMBEDDING_MODEL` | Local embeddings model (default `nomic-embed-text`); vectors are zero-padded to 1536 dims |
| `ENABLE_LOCAL_MODEL` / `LOCAL_MODEL_URL` / `LOCAL_MODEL_NAME` | Enable + locate the local Ollama model for inference |
| `LOCAL_MODEL_TIMEOUT_MS` | Local inference budget in ms (default `5000`); governs both the abort timeout and the success-routing latency gate in `lib/ModelManager.ts` |
| `EMBEDDING_TIMEOUT_MS` | Embedding request budget in ms (default `10000`) for `lib/embeddings.ts`'s OpenAI/Ollama fetch calls; falls back to `LOCAL_MODEL_TIMEOUT_MS` if unset |

Use `SUPABASE_SERVICE_ROLE_KEY` server-side only. Never expose it to the client.

## CI / Workflows

| Workflow | Trigger | What it does |
|----------|---------|---------------|
| `unit-tests.yml` | push to `clean-main`, all PRs | `npm test -- --coverage --forceExit`, uploads to Codecov |
| `hdi-governance-gate.yml` | PRs touching `supabase/migrations/**` | 7-gate schema review: change detection, transformer tests, state machine approval, adversarial tests, replay fidelity, performance regression, blueprint sync |
| `health-monitor.yml` | Scheduled | Pings health endpoint |
| `codeql.yml` | Scheduled | Static security analysis |

**Governance gate rule**: every new `.sql` migration must have a corresponding test in `tests/migrations/<version>.test.js`. State machine changes (enums, allowed transitions) require `STATE_MACHINE_APPROVED` in the PR description.

## Testing Layout

```
tests/
  unit/                          # Jest unit tests (run via npm test)
    heidi-core-loop.test.js
    heidi-action-layer.test.js
    heidi-memory-system.test.js
    heidi-orchestrator.test.js
    hybrid-model-stack.test.js
    stripe-webhook.test.js
    subscription-manager.test.js
  hdi-adversarial.test.js        # Adversarial / chaos integration tests
  hdi-everything-wrong.test.js   # Edge-case / failure-mode integration tests
```

The integration tests (`test:integration`) require live environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

## Secret Handling Protocol

Per `SECURITY_PROTOCOL.md`: secrets must **never** be displayed, echoed, logged, or pasted. Use direct injection only:

```bash
# Correct: pipe directly into the destination
node -e "require('crypto').randomBytes(32).toString('hex')" | vercel env add SECRET_NAME

# Verify presence without revealing value
vercel env ls | grep SECRET_NAME
```

## MCP Integration

`.mcp.json` configures the Supabase MCP server for direct DB tooling during development:
```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=akbnfovjdcobifeupvbn&features=docs,account,database,debugging,development,functions,branching,storage"
    }
  }
}
```

## Local-First Architecture (decision made 2026-07-10)

J's explicit direction: minimize reliance on external platforms, run Hydi as
local as possible. This is not aspirational — it's already load-bearing:
when Vercel's Marketplace billing suspended the cloud Supabase project, the
system kept running because the data plane had already been moved local.

**What's fully local (no cloud dependency in the critical path):**
- LLM inference: Ollama, self-hosted. Cloud keys (`ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`) are unset/dead and not required.
- Embeddings: Ollama `nomic-embed-text` (`EMBEDDING_PROVIDER=ollama`).
- Data plane: local Supabase via Docker (`supabase start`) — Postgres +
  pgvector + PostgREST, self-hosted. **Docker Desktop must be running.**
- Execution: `heidi-core`'s mission worker, health observer, and
  `ActionExecutor` never call out to any cloud service.

**External by necessity, minimized to just the necessary touchpoint:**
- **Stripe** — no local substitute exists for real card payments. Kept, but
  should only ever be touched at the actual charge step, not woven through
  everything else.

**External and deliberately disabled/unused, not deleted:**
- **Vercel deployment** — not used. No git integration is linked to the
  Vercel project (confirmed via API: `link: undefined`) — nothing
  auto-deploys on push. `scripts/cloud-bootstrap/vercel.js` still exists
  (dormant capability) but isn't part of the normal workflow.
  `.github/workflows/health-monitor.yml`'s `vercel-api-check.js` step is a
  read-only diagnostic, not a deploy trigger — safe to leave.
- **GitHub Pages** — `.github/workflows/deploy-pages.yml` used to
  auto-publish the mobile chat PWA on every push touching `docs/**`
  (confirmed Pages was NOT actually enabled when checked, so nothing was
  live, but the workflow would silently re-enable and publish on the next
  matching push). Trigger changed to `workflow_dispatch` only — manual, not
  automatic. Mobile chat is reached via Tailscale
  (`heidi-pc.tailc50af2.ts.net`) instead.

**External and kept, but reliance reduced:**
- **GitHub (repo host + Actions CI)** — still the remote and still what
  `clean-main` branch protection requires checks from. A local git hook
  (`.githooks/pre-push`, wired up automatically via `npm install`'s
  `postinstall` → `git config core.hooksPath .githooks`) runs typecheck +
  the full Jest suite before every push, so day-to-day development has a
  source of truth that doesn't depend on GitHub Actions being up. This
  exists directly because Actions sat stuck `queued`, repo-wide, for 24+
  hours starting 2026-07-08 (see PRs #167-169's merges, which used
  `gh pr merge --admin` to get past it). Skip the hook once with
  `git push --no-verify` when genuinely needed.
- Full self-hosted git (e.g. Gitea, replacing GitHub as the remote
  entirely) was considered and explicitly declined for now — GitHub stays
  as the remote/backup, this is about not *depending* on it operationally.

## Notable Conventions

- **Mixed module styles**: some `api/` files use `export default` (ESM) while others use `module.exports` (CJS). The project's Next.js build handles this, but Edge Functions are pure ESM (Deno).
- **TypeScript strict mode is enforced**: `next.config.js` does NOT suppress TS/ESLint errors. Run `npm run typecheck` before any PR. Catch variables are `unknown` — use `error instanceof Error ? error.message : 'Unknown error'` everywhere.
- **The `clean-main` branch** is the primary branch (CI runs against it, not `main`).
- **`.sql.skip` files**: migrations with this suffix are intentionally skipped by the runner; they document attempted approaches that were superseded.
- **`system_dashboard` view**: the central Supabase view consumed by health checks, Ursula status queries, and infrastructure monitoring — if this view is broken, health endpoints degrade gracefully to `503`.
- **`nnotification.service.ts`**: this file has a double-`n` typo in its name — do not rename it until all imports are updated together.
