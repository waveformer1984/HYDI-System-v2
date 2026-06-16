# SYSTEM ARCHITECTURE — HYDI System v2

> Canonical reference document. All other architecture docs (`HEIDI_V2_ARCHITECTURE.md`, `GROUNDED_ARCHITECTURE.md`, `SYSTEM_ENFORCEMENT_ARCHITECTURE.md`) are supplementary. This file is the single source of truth for the full system inventory.

---

## 1. What This System Does

HYDI System v2 ("Heidi" / "ProtoForge → Kilo Node") is a monetizable AI orchestration platform. It turns ProtoForge into an executable, revenue-generating system by running a deterministic event pipeline over an immutable ledger, managing multi-stream Stripe Connect billing, hosting a Next.js frontend on Vercel, offloading async work to 68 Supabase Edge Functions (Deno), and coordinating hardware/HID agents (Python) for physical device automation.

**Six active revenue streams** routed through Stripe Connect:

| Slug | Description |
|------|-------------|
| `galactic_bytes` | Galactic Bytes service stream |
| `detailer_bot` | Detailer Bot automation stream |
| `lipi_v2` | Lipi v2 content stream |
| `protogrance_aromatics` | Protogrance Aromatics product stream |
| `rezonate` | Rezonate music stream |
| `waveformer_studio` | Waveformer Studio creative stream |

---

## 2. Core Pipeline — HEIDI V2 Single Truth Architecture

Every event flows through exactly **six layers**, in order. No layer performs another's job.

```
[1] Ingestion Layer    → normalizes structure only, no interpretation
[2] RAW EVENT LEDGER   → append-only, immutable, hashed — single source of truth
[3] CASCADE            → classifies events → { classification, confidence, matched_rules }
[4] KILO               → generates hypotheses only, never executes → { hypotheses, suggested_fixes }
[5] ProtoForge         → policy engine, accepts/rejects KILO suggestions
[6] Emission Layer     → SSE / API / logs, no logic
```

A **Replay Engine** runs outside this pipeline and validates determinism: identical RAW LEDGER input must produce identical pipeline output. Divergence equals confirmed drift.

### Key Architectural Constraint

V1 built enforcement before establishing ground truth, causing false positives and feedback loops. V2 inverts this: **truth is anchored first (RAW LEDGER), then enforcement layers run on top**.

Two cooldown windows enforce this:
- **Startup window**: 2 minutes — no enforcement
- **Drift observation**: 30 seconds before alerts fire

---

## 3. Named Agents / Subsystems

| Name | Role | Entry point |
|------|------|-------------|
| **Heidi** | Conversational orchestrator, task management | `api/heidi/route.js` |
| **Ursula** | System monitor / status interface | `api/ursula/status.js`, `api/chat/route.js` |
| **CASCADE** | Event classifier (classification only) | Routed via `api/chat/route.js` |
| **KILO** | Hypothesis generator (no execution authority) | Routed via `api/chat/route.js` |
| **ProtoForge** | Policy engine / governance layer | Routed via `api/chat/route.js` |
| **Hyve** | Opportunity collective / swarm intelligence | Routed via `api/chat/route.js` |

---

## 4. API Layer (`api/`)

All files under `api/` are Vercel serverless functions (Next.js API routes). They use ES module `export default async function handler(req, res)` style.

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

---

## 5. Frontend (`pages/`, `components/`, `hooks/`)

### Pages (`pages/`)

| File | Purpose |
|------|---------|
| `pages/index.tsx` | Main dashboard |
| `pages/agent-manager.tsx` | Agent management UI |
| `pages/funding.tsx` | Funding pipeline view |
| `pages/song-composer.tsx` | Rezonate music composer integration |
| `pages/trace-viewer.jsx` | Event trace inspection |
| `pages/traces.jsx` | Trace listing |

### Components (`components/`)

| File / Directory | Purpose |
|-----------------|---------|
| `AgentBoard.tsx` | Agent status grid |
| `AgentCard.tsx` | Per-agent status card |
| `Chat.tsx` | Heidi chat interface |
| `StatusPanel.tsx` | System health display |
| `TaskCreateModal.tsx` | Task creation modal |
| `TaskQueue.tsx` | Task pipeline view |
| `components/funding/` | Funding-specific components |
| `components/song-composer/` | Song composer components |

### Hooks (`hooks/`)

| File | Purpose |
|------|---------|
| `hooks/useHeidi.ts` | React hook for Heidi orchestration state |

---

## 6. Supabase Edge Functions (`supabase/functions/`)

**Total active functions: 68** (Deno, ESM). JWT enforcement is configured per-function in `supabase/config.toml`.

> If a 42-function view is needed, create a curated production-core subset explicitly rather than treating any partial list as the canonical count.

### 6.1 Core Orchestration & Governance (17)

| Slug | Notes |
|------|-------|
| `core-dispatcher` | Central dispatch controller |
| `core-agent-heartbeat` | Agent liveness tracking |
| `core-recovery-worker` | Auto-recovery on failure |
| `core-operator-api` | Operator management API |
| `worker-orchestrator` | Worker lifecycle orchestration |
| `governed-execute` | Execution under governance constraints |
| `publish-event` | Event publishing to the ledger bus |
| `claim-work` | Work-item claim/lock primitive |
| `submit-approval-decision` | Routes approval outcomes |
| `emit-risk-alert` | Emits risk alerts to downstream |
| `keymaker-router` | Routes key-management requests |
| `tool-executor` | Executes tool calls from agents |
| `action-worker` | Processes action items from the queue |
| `events-stream` | SSE event stream (public) |
| `jobs-processor` | Background job processing |
| `monitoring-health` | Health check and observability |
| `api-gateway` | Public API gateway (no JWT) |

### 6.2 HYDI / HEIDI Intelligence (17)

| Slug | Notes |
|------|-------|
| `hydi-transition` | HYDI state transitions |
| `hydi-reflect` | HYDI self-reflection / audit pass |
| `hydi-heartbeat` | HYDI liveness signal |
| `hydi-repair` | HYDI repair and recovery |
| `hydi-boot` | HYDI boot-sequence initializer |
| `hydi-alignment-audit` | Alignment audit for HYDI decisions |
| `hydi-outcome-ingest` | Ingests HYDI decision outcomes |
| `hydi-memory` | HYDI memory store operations |
| `theme-calibration` | Calibrates system response theme/tone |
| `heidi-reflect` | Heidi self-reflection pass (public) |
| `heidi-ingest-event` | Heidi event ingestion |
| `heidi-orchestrator` | Heidi orchestration logic |
| `chaos-runner` | Chaos/adversarial test execution |
| `run-followups` | Scheduled follow-up task runner |
| `send-outreach` | Outreach message dispatch |
| `chat-operator` | Chat session operator |
| `toby-llm` | LLM routing via Toby layer |

### 6.3 Billing / Revenue / Stripe (17)

| Slug | Notes |
|------|-------|
| `stripe-setup` | Stripe account setup helper |
| `stripe-webhook` | Stripe event webhook handler (public) |
| `stripe-worker` | Async Stripe job worker |
| `stripe-connect-webhook` | Stripe Connect webhook handler |
| `stripe-connect-admin` | Connect account administration |
| `stripe-transfer-payout` | Initiates Stripe transfer payouts |
| `stripe-webhook-revenue` | Revenue-specific Stripe webhook path |
| `sync-stripe-events` | Syncs Stripe events to the ledger |
| `monthly-payout-calculation` | pg_cron-triggered monthly payout calc |
| `revenue-tracker` | Tracks revenue events across streams |
| `billing-engine` | Core billing computation engine |
| `billing-retry-worker` | Retries failed billing attempts |
| `usage-monitor` | Monitors usage for billing thresholds |
| `invoice-generator` | Generates invoices from ledger data |
| `subscription-manager` | Manages subscription lifecycle |
| `payment-processor` | Processes individual payments |
| `payment-processing` | Payment processing pipeline |

### 6.4 Platform / App Services (6, no JWT)

| Slug | Notes |
|------|-------|
| `user-management` | User CRUD and provisioning |
| `notification-service` | Push/email notification dispatch |
| `analytics-service` | Analytics event ingestion and aggregation |
| `file-storage` | File upload and retrieval |
| `search-service` | Full-text and semantic search |
| `cache-service` | Cache read/write layer |

### 6.5 Marketing / Growth (8, no JWT)

| Slug | Notes |
|------|-------|
| `marketing-automation` | Automated marketing workflow runner |
| `lead-generation` | Lead capture and scoring |
| `content-management` | Content CRUD and scheduling |
| `email-marketing` | Email campaign execution |
| `social-media` | Social media post management |
| `customer-segments` | Audience segmentation engine |
| `campaign-analytics` | Campaign performance tracking |
| `brand-awareness` | Brand reach analytics |

### 6.6 Ops / Safety (3)

| Slug | Notes |
|------|-------|
| `keeper` | Runtime safety keeper |
| `keeper-break-glass` | Emergency break-glass access |
| `keeper-break-glass-simple` | Simplified break-glass path |

---

## 7. PAO System (`pao-system/`)

The PAO (Personal AI Orchestration) subsystem contains TypeScript agents running under strict mode.

### 7.1 Core (`pao-system/core/`)

| File | Role |
|------|------|
| `heidi.controller.ts` | Central orchestrator — `taskRoutingMatrix: Map<string, string[]>`, emits events, manages session state |
| `agent.registry.ts` | Agent registration and discovery |
| `approval.engine.ts` | Action approval workflow |
| `ethical-decision-engine.ts` | Ethical guardrails for agent decisions |
| `event.bus.ts` | Internal event pub/sub |
| `risk.engine.ts` | Risk scoring for proposed actions |
| `task.router.ts` | Routes tasks to the correct agent |

### 7.2 Agents (`pao-system/agents/`)

15 agents grouped by domain:

**Business**

| File | Role |
|------|------|
| `revenue.agent.ts` | Revenue generation and tracking |
| `funding.agent.ts` | Funding pipeline (uses `.getTime()` for Date arithmetic) |
| `finance.agent.ts` | Financial analysis and reporting |

**Operations**

| File | Role |
|------|------|
| `facility.agent.ts` | Physical facility management |
| `security.agent.ts` | Security posture and monitoring |
| `workflow.agent.ts` | Process workflow automation |
| `procurement.agent.ts` | Procurement and vendor management |

**Outreach**

| File | Role |
|------|------|
| `community.agent.ts` | Community engagement |
| `marketing.agent.ts` | Marketing execution |
| `outreach.agent.ts` | External outreach coordination |

**Execution**

| File | Role |
|------|------|
| `construction.agent.ts` | Construction/build project execution |
| `fabrication.agent.ts` | Physical fabrication coordination |

**Strategic**

| File | Role |
|------|------|
| `ai.agent.ts` | AI strategy and model selection |
| `architect.agent.ts` | System architecture decisions |
| `energy.agent.ts` | Energy/sustainability strategy |

### 7.3 Services (`pao-system/services/`)

| File | Role |
|------|------|
| `llm.service.ts` | LLM invocation abstraction |
| `storage.service.ts` | Persistent storage operations |
| `notification.service.ts` | Notification dispatch |
| `nnotification.service.ts` | Secondary notification path (double-`n` typo — do not rename until all imports are updated together) |

### 7.4 Integrations (`pao-system/integrations/`)

| File | Role |
|------|------|
| `email.ts` | Email delivery integration |
| `grants.api.ts` | Grants database API integration |
| `stripe.ts` | Stripe billing integration |

### 7.5 Schemas (`pao-system/schemas/`)

| File | Role |
|------|------|
| `event.schema.ts` | Event payload schema |
| `finance.schema.ts` | Financial record schema |
| `task.schema.ts` | Task definition schema |

### 7.6 Knowledge Base (`pao-system/knowledge/`)

Markdown files that form the agent knowledge layer:
- `agent-prompts` — per-agent system prompts
- `cultural-tone` — tone and voice guidelines
- `ethos-mission` — platform mission and values
- `integration-rules` — rules governing external integrations
- `public-mission` — public-facing mission statement
- `unified-cognitive-layer` — cross-agent cognitive framework

---

## 8. Revenue Engine (`revenue-engine/`)

Standalone revenue pipeline module, separate from the API layer.

| File | Role |
|------|------|
| `index.js` | Entry point |
| `revenue-engine-v2.js` | V2 engine with enhanced logic and accuracy |
| `reality-filter.js` | Filters unrealistic revenue projections before they propagate |
| `schema.sql` | Revenue engine database schema |
| `outcome-schema.sql` | Revenue outcome schema |
| `modules/` | Sub-modules (transformers, calculators, validators) |

---

## 9. KILO Module (`kilo/`)

Standalone implementation of the KILO hypothesis generator — the fourth layer of the core pipeline.

| Path | Role |
|------|------|
| `kilo/index.js` | Entry point |
| `kilo/modules/repair-manifest-validator.js` | Validates repair manifests before KILO processes them |
| `kilo/modules/truth-filter-gate.js` | Gates hypotheses against ground truth before emission |

KILO has **no execution authority**. It outputs `{ hypotheses, suggested_fixes }` only. ProtoForge decides whether to act.

---

## 10. Hyve Service (`hyve_service/`)

Python-based Hyve opportunity-collective service implementing swarm intelligence for opportunity detection.

| Path | Role |
|------|------|
| `hyve_service/listener.py` | Listens for opportunity signals from the event bus |
| `hyve_service/outputs/` | Directory for processed output artifacts |
| `hyve_service/revenue_ready/` | Revenue-ready configuration state |

---

## 11. Agents (`agents/`)

### Specialized Agents (`agents/specialized/`)

| File | Role |
|------|------|
| `agent-factory.js` | Factory that creates typed business and execution agents |
| `business-agents.js` | Business domain agents (~70 KB) |
| `execution-agents.js` | Execution domain agents (~54 KB) |

### HID Agents (`agents/hid/`)

JavaScript key-rotation agent and secure key setup (PowerShell + JS) for hardware identity management.

### Hardware Controller (`agents/hardware-controller/`)

Python agents for physical hardware automation:
- USB HID controller
- Screen vision agent
- Stripe/Vercel UI navigation (pyautogui/vision)
- Safety orchestrator

---

## 12. Database (`supabase/`)

Schema managed via numbered migrations in `supabase/migrations/`. Files ending in `.sql.skip` are intentionally excluded from the migration runner.

**Supabase project ref**: `akbnfovjdcobifeupvbn`

### Core Tables

| Table | Description |
|-------|-------------|
| `memories` | Vector embeddings (1536-dim, `pgvector`), scoped by `user_id` / `session_id` |
| `actions` | Task action log — statuses: `pending` / `completed` / `failed` |
| `sessions` | Session state: tone, active model, last action |
| `ledger` | Immutable financial ledger: gross amount, fee breakdown (platform 5%, agent 10%, Stripe 2.9% + $0.30), net, payout status |
| `clients` | Client registry |
| `payouts` | Payout batches |
| `leads` | Revenue pipeline: leads |
| `quotes` | Revenue pipeline: quotes |
| `proposals` | Revenue pipeline: proposals |
| `checkout_sessions` | Stripe checkout session tracking |

### Key Database Features

- **RLS** enabled on all tables
- **`system_dashboard` view** drives health endpoints — if this view is broken, health endpoints degrade gracefully to `503`
- **`pg_cron`** schedules billing retry (`billing-retry-worker`) and monthly payout calculation (`monthly-payout-calculation`)
- **RPC functions** for tool execution and auto-healing

---

## 13. Ursula Suite (Local Companion)

The Ursula EPM Service Suite is a companion Flask server (`C:\ProtoForge_Ecosystem\Ursula_Suite\`) running at `http://localhost:5000`. It is a separate Python codebase — not deployed to Vercel.

| App | Blueprint prefix | Description |
|-----|-----------------|-------------|
| Proto.I.Y | `/proto_iy` | Projects & Timelines |
| BlameGames | `/blame_games` | Betting & Challenges |
| PorchWise | `/porch_wise` | Family Management |
| Rezonette | `/rezonette` | Music Production |
| Checkpoint | `/checkpoint` | QA & Risk Analysis |

### Checkpoint App (`apps/checkpoint/`)

Risk-scored workflow analysis:

| File | Role |
|------|------|
| `checkpoint_qa.py` | QA engine with SQLite backend, risk scoring, failure point detection, auto-checkpoint creation |
| `routes.py` | Flask Blueprint using `importlib.util.spec_from_file_location` for bulletproof module loading |

Test suite: `ursula-suite/checkpoint/tests/phase2_test_suite.ps1`
Dashboard: `ursula-suite/checkpoint/dashboard/dashboard.html`

---

## 14. Environment Variables

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — **server-side only, never expose to client** |
| `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL exposed to client |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET_01` | Stripe webhook signing secret |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Stripe Connect webhook signing secret |
| `STRIPE_ACCOUNT_GALACTIC_BYTES` et al. | Connect sub-account IDs per revenue stream |
| `NODE_ENV` | `production` / `development` |

---

## 15. CI / Workflows

| Workflow | Trigger | What it does |
|----------|---------|---------------|
| `unit-tests.yml` | Push to `clean-main`, all PRs | `npm test -- --coverage --forceExit`, uploads to Codecov |
| `hdi-governance-gate.yml` | PRs touching `supabase/migrations/**` | 7-gate schema review: change detection, transformer tests, state machine approval, adversarial tests, replay fidelity, performance regression, blueprint sync |
| `health-monitor.yml` | Scheduled | Pings health endpoint |
| `codeql.yml` | Scheduled | Static security analysis |

**Governance gate rule**: every new `.sql` migration must have a corresponding test in `tests/migrations/<version>.test.js`. State machine changes (enums, allowed transitions) require `STATE_MACHINE_APPROVED` in the PR description.

The **`clean-main` branch** is the primary branch — CI runs against it, not `main`.

---

## 16. Testing Layout

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

Integration tests (`npm run test:integration`) require live environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

---

## 17. Notable Conventions

- **Mixed module styles**: some `api/` files use `export default` (ESM) while others use `module.exports` (CJS). Edge Functions are pure ESM (Deno).
- **TypeScript strict mode**: `next.config.js` does not suppress TS/ESLint errors. Run `npm run typecheck` before any PR. Catch variables are `unknown` — use `error instanceof Error ? error.message : 'Unknown error'` everywhere.
- **`.sql.skip` files**: migrations with this suffix are intentionally skipped by the runner; they document superseded approaches.
- **`nnotification.service.ts`**: double-`n` typo in the filename — do not rename until all imports are updated together.
- **MCP integration**: `.mcp.json` configures the Supabase MCP server for direct DB tooling during development (`project_ref=akbnfovjdcobifeupvbn`).
- **Secret handling**: secrets must never be displayed, echoed, logged, or pasted. Use direct injection only (`node -e "..." | vercel env add SECRET_NAME`).
