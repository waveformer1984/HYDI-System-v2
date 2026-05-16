# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This System Does

HYDI System v2 (also called "Heidi" / "ProtoForge → Kilo Node") is a monetizable AI orchestration platform. It turns ProtoForge into an executable revenue-generating system by:

- Running a deterministic event pipeline (CASCADE → KILO → ProtoForge) over an immutable RAW EVENT LEDGER
- Managing multi-revenue-stream billing via Stripe Connect with per-project sub-accounts
- Hosting a Next.js frontend with Vercel serverless API routes
- Offloading async work to ~35 Supabase Edge Functions (Deno)
- Coordinating hardware/HID agents (Python) for physical device automation

The six active revenue streams routed through Stripe Connect are: `galactic_bytes`, `detailer_bot`, `lipi_v2`, `protogrance_aromatics`, `rezonate`, and `waveformer_studio`.

## Commands

```bash
npm install          # Install dependencies (Node >= 20 required)
npm run dev          # Next.js dev server on 0.0.0.0:3000
npm run build        # Production build
npm start            # Start production server
npm test             # Run Jest unit tests
npm run test:watch   # Jest in watch mode
npm run test:coverage  # Jest with coverage report
npm run test:integration  # Run adversarial integration tests (tests/hdi-adversarial.test.js)
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

### API Layer (`api/`)

All files under `api/` are **Vercel serverless functions** (Next.js API routes). They use ES module `export default async function handler(req, res)` style. Note: some files mix `import` and `require` — be consistent within a file.

| Route | Purpose |
|-------|---------|
| `api/chat/route.js` | Universal chat router — dispatches `{ message, system }` to the correct named agent |
| `api/health.js` | Reads the `system_dashboard` Supabase view for live health metrics |
| `api/heidi/route.js` | Heidi-specific orchestration endpoint |
| `api/hydi/sync.js` | HYDI state sync |
| `api/ursula/status.js` | Ursula system status |
| `api/life-flow/route.js` | Life-flow module |
| `api/events/stream.js` | SSE stream for real-time events |
| `api/revenue.js` | Revenue engine: leads, quotes, proposals, Stripe checkout, reports |
| `api/client-dashboard.js` | Per-project ledger view with fee breakdown |
| `api/checkout.js` / `api/checkout-v2.js` | Stripe Checkout session creation |
| `api/stripe-connect-webhook.js` | Main Stripe Connect webhook — routes payments to sub-accounts, writes ledger entries |
| `api/webhooks/stripe.js` | Standard Stripe webhook handler |
| `api/local-model.js` | Local model inference integration |

### Supabase Edge Functions (`supabase/functions/`)

~35 Deno-based Edge Functions handle async work. JWT enforcement is configured per-function in `supabase/config.toml`. Key functions:

- **`chat-operator`** — async chat processing
- **`tool-executor`** / **`action-worker`** / **`agent-worker`** — task queue workers
- **`billing-engine`** / **`billing-retry-worker`** / **`payment-processor`** / **`stripe-webhook`** / **`stripe-connect-admin`** / **`stripe-transfer-payout`** — billing pipeline
- **`keymaker-gate`** / **`keeper-break-glass`** / **`keeper-break-glass-simple`** — authentication and emergency access
- **`heidi-reflect`** / **`hydi-transition`** — Heidi self-reflection and state transitions
- **`monitoring-health`** / **`chaos-runner`** — observability and chaos testing
- **`revenue-tracker`** / **`usage-monitor`** / **`invoice-generator`** / **`subscription-manager`** — revenue operations
- **`events-stream`** — real-time event streaming

Public functions (no JWT): `api-gateway`, `notification-service`, `search-service`, `cache-service`, all marketing functions, `stripe-webhook`, `heidi-reflect`.

### Agents (`agents/`)

- **`agents/specialized/agent-factory.js`** — factory that creates typed business and execution agents
- **`agents/specialized/business-agents.js`** — business domain agents (large, ~70KB)
- **`agents/specialized/execution-agents.js`** — execution domain agents (~54KB)
- **`agents/hid/`** — JavaScript key-rotation agent and secure key setup (PowerShell + JS)
- **`agents/hardware-controller/`** — Python agents for physical hardware: USB HID controller, screen vision, Stripe/Vercel UI navigation via pyautogui/vision, safety orchestrator

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
|----------|----------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |
| `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL exposed to client |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET_01` | Stripe webhook signing secret |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Stripe Connect webhook signing secret |
| `STRIPE_ACCOUNT_GALACTIC_BYTES` et al. | Connect sub-account IDs per revenue stream |
| `NODE_ENV` | `production` / `development` |

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

## Notable Conventions

- **Mixed module styles**: some `api/` files use `export default` (ESM) while others use `module.exports` (CJS). The project's Next.js build handles this, but Edge Functions are pure ESM (Deno).
- **TypeScript is present but soft**: `next.config.js` sets `ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true` — the build won't fail on type errors.
- **The `clean-main` branch** is the primary branch (CI runs against it, not `main`).
- **`.sql.skip` files**: migrations with this suffix are intentionally skipped by the runner; they document attempted approaches that were superseded.
- **`system_dashboard` view**: the central Supabase view consumed by health checks, Ursula status queries, and infrastructure monitoring — if this view is broken, health endpoints degrade gracefully to `503`.
