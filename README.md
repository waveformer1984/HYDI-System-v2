# HYDI System v2

[![Unit Tests](https://github.com/waveformer1984/HYDI-System-v2/actions/workflows/unit-tests.yml/badge.svg?branch=clean-main)](https://github.com/waveformer1984/HYDI-System-v2/actions/workflows/unit-tests.yml)
[![CodeQL](https://github.com/waveformer1984/HYDI-System-v2/actions/workflows/codeql.yml/badge.svg)](https://github.com/waveformer1984/HYDI-System-v2/actions/workflows/codeql.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

**HYDI System v2** ("Heidi" / "ProtoForge → Kilo Node") is a monetizable AI orchestration platform. It turns ProtoForge into an executable, revenue-generating system by running a deterministic event pipeline over an immutable ledger and routing payments through Stripe Connect.

## How It Works

Every event flows through six layers in strict order:

```
[1] Ingestion       → normalizes structure only
[2] RAW EVENT LEDGER → append-only, immutable, hashed — single source of truth
[3] CASCADE         → classifies events → { classification, confidence, matched_rules }
[4] KILO            → generates hypotheses only, never executes → { hypotheses, suggested_fixes }
[5] ProtoForge      → policy engine, accepts/rejects KILO suggestions
[6] Emission        → SSE / API / logs, no logic
```

A Replay Engine validates determinism outside the pipeline: the same RAW LEDGER input must always produce the same output. Divergence = real drift.

The six active revenue streams routed through Stripe Connect: `galactic_bytes`, `detailer_bot`, `lipi_v2`, `protogrance_aromatics`, `rezonate`, `waveformer_studio`.

## Quick Start

```bash
# Requires Node >= 20
npm install
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY

npm run dev            # Next.js dev server on 0.0.0.0:3000
```

Verify Supabase connectivity:

```bash
./verify-supabase.sh
```

## Commands

```bash
npm run dev               # Next.js dev server
npm run build             # Production build
npm start                 # Start production server
npm run typecheck         # TypeScript check (tsc --noEmit)
npm test                  # Jest unit tests
npm run test:coverage     # Jest with coverage
npm run test:integration  # Adversarial integration tests (requires live Supabase)
./verify-supabase.sh      # Health check: Supabase connectivity + key tables
./deploy-production-safe.sh  # Pre-flight checked production deploy
./setup.sh                # First-time environment setup
```

Run a single test file:
```bash
npx jest tests/unit/heidi-core-loop.test.js --verbose
```

## Architecture

### Named Agents

| Agent | Role | Entry point |
|-------|------|-------------|
| **Heidi** | Conversational orchestrator | `api/heidi/route.js` |
| **Ursula** | System monitor / status | `api/ursula/status.js` |
| **CASCADE** | Event classifier | `api/chat/route.js` |
| **KILO** | Hypothesis generator (no execution authority) | `api/chat/route.js` |
| **ProtoForge** | Policy engine / governance | `api/chat/route.js` |
| **Hyve** | Opportunity collective / swarm | `api/chat/route.js` |

### API Routes (`api/`)

| Route | Purpose |
|-------|---------|
| `api/chat/route.js` | Universal chat router |
| `api/health.js` | Live health metrics via `system_dashboard` Supabase view |
| `api/mobile-status.js` | Compact 3G-safe health + per-stream revenue snapshot |
| `api/heidi/route.js` | Heidi orchestration endpoint |
| `api/events/stream.js` | SSE stream for real-time events |
| `api/revenue.js` | Leads, quotes, proposals, Stripe checkout |
| `api/stripe-connect-webhook.js` | Stripe Connect webhook — routes payments to sub-accounts |

### Policy Engine (`lib/protoforge/`)

- `policy-engine.js` — evaluates KILO hypotheses against Supabase-loaded rules. DSL operators: `gte`, `lte`, `gt`, `lt`, `eq`, `neq`, `in`, `nin`, `contains`, `startsWith`, `regex`. Multi-condition grouping via `all`/`any`. Fail-closed: default is `'reject'`. Hot-reloads via Supabase Realtime.
- `auto-gate.js` — wraps PolicyEngine; runs automatically on every KILO output.
- `supabase/functions/protoforge-calibration/` — Edge Function that runs the calibration feedback loop via `calibrate_protoforge_decisions()` RPC.

### KILO Module (`kilo/`)

Exports `{ KiloEngine, createKiloEngine }` (CommonJS). `execute()` throws unconditionally — KILO generates hypotheses only; it never runs actions.

### Workers (`workers/`)

- `DecisionAssistWorker.js` — scores decision-assist tasks (financial_planning, resource_allocation, risk_assessment, system_optimization) against configurable confidence thresholds.
- `WorkerOrchestrator.js` — spawns and supervises workers. **Register any new worker here or the orchestrator will crash on startup.**

### Supabase Edge Functions (`supabase/functions/`)

42 Deno Edge Functions. Key groups:

- **Task workers**: `action-worker`, `agent-worker`, `tool-executor`, `chat-operator`, `jobs-processor`
- **Billing**: `billing-engine`, `billing-retry-worker`, `stripe-webhook`, `stripe-connect-admin`, `monthly-payout-calculation`
- **Observability**: `monitoring-health`, `chaos-runner`, `analytics-service`, `stream-health-watchdog`
- **Policy**: `protoforge-calibration`

### Database

Supabase project ref: `akbnfovjdcobifeupvbn`. Core tables: `memories` (pgvector, 1536-dim), `actions`, `sessions`, `ledger`, `clients`, `payouts`, `leads`, `quotes`, `proposals`, `checkout_sessions`. The `system_dashboard` view drives all health endpoints.

## Repository Structure

```
.
├── api/                    # Vercel serverless functions (Next.js API routes)
├── components/             # React components (AgentBoard, Chat, StatusPanel, etc.)
├── pages/                  # Next.js pages (index, agent-manager, funding, traces)
├── hooks/                  # React hooks (useHeidi.ts)
├── pao-system/             # PAO TypeScript agents (core, agents, services, integrations)
├── kilo/                   # KILO hypothesis generator module
│   └── modules/            # repair-manifest-validator, truth-filter-gate
├── lib/protoforge/         # DSL policy engine + auto-gate
├── revenue-engine/         # Revenue pipeline module
├── workers/                # Background workers (DecisionAssistWorker, WorkerOrchestrator)
├── agents/                 # Specialized agents + hardware controller (Python)
│   └── hardware-controller/
├── hyve_service/           # Hyve opportunity-collective (Python)
├── supabase/
│   ├── functions/          # 42 Deno Edge Functions
│   └── migrations/         # Numbered SQL migrations (.sql.skip = intentionally skipped)
├── tests/
│   ├── unit/               # Jest unit tests
│   ├── hdi-adversarial.test.js
│   └── hdi-everything-wrong.test.js
├── .github/workflows/      # CI: unit-tests, hdi-governance-gate, health-monitor, codeql
├── verify-supabase.sh      # Supabase health check
├── deploy-production-safe.sh
└── setup.sh
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL for client |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET_01` | Webhook signing secret |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Connect webhook secret |
| `STRIPE_ACCOUNT_GALACTIC_BYTES` et al. | Connect sub-account IDs per stream |
| `NODE_ENV` | `production` / `development` |

Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.

## CI

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `unit-tests.yml` | push to `clean-main`, all PRs | Jest + coverage, uploads to Codecov |
| `hdi-governance-gate.yml` | PRs touching `supabase/migrations/**` | 7-gate schema review |
| `health-monitor.yml` | Scheduled | Pings health endpoint |
| `codeql.yml` | Scheduled | Static security analysis |

**Primary branch is `clean-main`** — CI runs against it, not `main`.

Every new `.sql` migration requires a corresponding test in `tests/migrations/<version>.test.js`. State machine changes require `STATE_MACHINE_APPROVED` in the PR description.

## Secret Handling

Per `SECURITY_PROTOCOL.md` — never display, echo, log, or paste secrets:

```bash
# Correct: pipe directly
node -e "require('crypto').randomBytes(32).toString('hex')" | vercel env add SECRET_NAME

# Verify without revealing
vercel env ls | grep SECRET_NAME
```

## Community

| Document | Purpose |
|----------|---------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, PR checklist, DB migration governance, CI summary |
| [GOVERNANCE.md](GOVERNANCE.md) | Decision-making process, RFC policy, maintainer responsibilities |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and coordinated disclosure |
| [SUPPORT.md](SUPPORT.md) | How to get help and which issue template to use |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community standards |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [AGENTS.md](AGENTS.md) | Guidelines for AI agents working in this codebase |

## License

MIT
