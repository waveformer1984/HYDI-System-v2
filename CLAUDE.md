# CLAUDE.md — HYDI System v2 (heidi-cascade-production)

This file provides context for AI coding assistants working in this repository.

---

## What This Repo Is

**HYDI System v2** is the execution and revenue layer for the ProtoForge platform — codenamed *Kilo Node*. It exposes a Next.js 15 frontend alongside an Express-based API server (`src/server.js`) and integrates Supabase for event persistence and Stripe for payment processing.

The system manages:
- A **Cascade bridge** for bidirectional communication between ProtoForge modules
- Revenue-ready endpoints (`/process`, `/insight`, `/event`)
- Webhook handlers for Stripe events
- Usage tracking and system health metrics
- Supabase-backed event sourcing

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 18, Tailwind CSS |
| Backend | Node.js ≥ 20, Express (port 3005 by default) |
| Database | Supabase (PostgreSQL) via `@supabase/supabase-js` / `@supabase/ssr` |
| Payments | Stripe (`stripe` SDK) |
| Testing | Jest 29 (`tests/unit/**/*.test.js`) |
| Language | JavaScript (CommonJS), TypeScript types via `@types/*` |
| Deployment | Vercel (Next.js), Netlify (`netlify.toml` also present) |

---

## Repository Structure

```
hydi-system-v2/
├── src/
│   ├── server.js            # Full production Express server (52 KB) — canonical runtime
│   ├── server-clean.js      # Lightweight standalone server for isolated testing/dev
│   ├── HYDISystem.js        # Core system class
│   ├── database.js          # Supabase client & DB helpers
│   ├── actions/             # Server-side action handlers
│   ├── api/                 # API route modules
│   ├── audit/               # Audit logging
│   ├── awareness/           # System awareness / self-monitoring
│   ├── control/             # Control-plane logic
│   ├── core/                # Core domain logic
│   ├── enforcement/         # Policy enforcement
│   ├── lib/                 # Shared utilities / libraries
│   ├── memory/              # In-memory and persistent memory layer
│   ├── middleware/          # Express middleware
│   ├── models/              # Data models
│   ├── orchestrator/        # Task orchestration
│   ├── revenue/             # Revenue tracking & hooks
│   ├── services/            # External service integrations
│   └── webhook-handlers/    # Stripe & other webhook processors
│
├── pages/                   # Next.js page routes
├── components/              # React UI components
├── public/                  # Static assets
│
├── kilo.js                  # Kilo execution engine (Cascade bridge)
├── kilo/                    # Built-in Kilo modules
├── modules/                 # Custom modules directory
│
├── supabase/
│   ├── config.toml          # Supabase local dev config
│   ├── migrations/          # SQL migration files (apply in filename order)
│   ├── functions/           # Supabase Edge Functions
│   └── heidi-init.sql       # Schema bootstrapping
│
├── agents/                  # Agent definitions
├── cascade/                 # Cascade communication modules
├── heidi-core/              # Heidi core reasoning modules
├── hooks/                   # Custom hooks
├── workers/                 # Background worker definitions
│
├── tests/
│   └── unit/                # Unit tests (Jest matches **/tests/unit/**/*.test.js)
│
├── next.config.js           # Next.js config (TypeScript & ESLint errors surface in build)
├── jest.config.js           # Jest config
├── tailwind.config.js       # Tailwind CSS config
├── package.json             # npm scripts & dependencies
└── .env.example             # Environment variable template
```

### Two Express servers — which to use

| File | Role |
|---|---|
| `src/server.js` | **Canonical production server.** Full-featured: WebSockets, event bus, billing, local models, agent bus, SSE. Start with `node src/server.js`. |
| `src/server-clean.js` | **Lightweight standalone server.** Minimal: ingest → validate → classify → persist → emit pipeline only. Useful for isolated dev or integration testing without the full dependency tree. |

Do not delete either — they serve different purposes. New production features go into `src/server.js`.

---

## Development Workflow

### Setup

```bash
npm install
cp .env.example .env   # fill in real values
```

### Run modes

```bash
npm run dev           # Next.js dev server (port 3000, hot-reload)
npm start             # next start (production mode)
node src/server.js    # Full Express API server (port 3005)
node src/server-clean.js  # Lightweight Express server (port 3005)
```

### Tests

```bash
npm test                   # Jest unit tests (tests/unit/**/*.test.js)
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report (≥50% line coverage required)
npm run test:integration   # node tests/hdi-adversarial.test.js
```

### Build

```bash
npm run build   # next build — TypeScript and ESLint errors now surface here
npm run lint    # next lint
```

> **Note:** TypeScript (`ignoreBuildErrors`) and ESLint (`ignoreDuringBuilds`) suppressions have been removed from `next.config.js`. Build failures now correctly surface errors. Fix them at source — do not re-add the suppressions.

---

## Environment Variables

Copy `.env.example` to `.env`. Required variables:

```
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET_01=

# App
NODE_ENV=development
```

`NEXT_PUBLIC_*` variables are exposed to the browser. Never put secrets in `NEXT_PUBLIC_*`.

---

## Key Modules

### `kilo.js` — Kilo Execution Engine
The central execution loop. Manages the **Cascade bridge** that connects ProtoForge to external modules and services. All module execution goes through here.

### `src/server.js` — Full Production Express Server
The canonical production server. Hosts the revenue endpoints, webhook processors, WebSocket chat server, local model adapter, event bus, and agent bus. Start this for production use.

### `src/server-clean.js` — Lightweight Standalone Server
A minimal ES-module server exposing only `POST /process`, `GET /health`, and `GET /metrics`. Validates and persists events through the event bus without the full dependency tree. Use for isolated development or integration tests.

### `src/HYDISystem.js` — HYDI Core
Top-level system class that orchestrates subsystems: awareness, control, enforcement, memory, and orchestration layers.

### `src/database.js` — Supabase Client
Wraps Supabase connection and exposes helper methods for reading/writing events and system state.

### Supabase Migrations
Migration files live in `supabase/migrations/`. They are numbered and must be applied in sequence. Do not modify existing migration files — add new ones.

---

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | System health check |
| POST | `/process` | Accept payload and trigger processing |
| GET | `/insight` | Return processed intelligence |
| POST | `/event` | Log system events to Supabase |

Webhook endpoints for Stripe live in `src/webhook-handlers/`.

---

## Testing Conventions

- Unit tests live in `tests/unit/` and must match `**/*.test.js`.
- Coverage threshold is **50% line coverage** globally (enforced by Jest).
- Integration tests use `tests/hdi-adversarial.test.js` and are run separately.
- Do not import `src/server.js` or `src/server-clean.js` in unit tests (excluded from coverage collection).
- Existing tests cover: subscription manager, stripe webhooks, core loop, orchestrator, memory system, action layer, hybrid model stack.

---

## CI/CD

- **Unit Tests**: `.github/workflows/unit-tests.yml` — triggers on push to `clean-main` or any PR. Runs `npm test -- --coverage --forceExit` on Node 20.
- **CodeQL**: `.github/workflows/codeql.yml` — static security analysis.
- **Codecov**: Coverage reports uploaded from the `clean-main` branch (flags: `unit`).
- **Dependabot**: Automated dependency PRs (`.github/dependabot.yml`).

---

## Coding Conventions

- **Language**: JavaScript (CommonJS `require`/`module.exports`) for `src/` and root scripts. TypeScript types are used via JSDoc or `@types/*` packages but the files themselves remain `.js`.
- **No comments** unless the WHY is non-obvious. Don't describe what code does.
- **Express middleware** goes in `src/middleware/`.
- **New integrations** get their own file in `src/services/`.
- **Webhook handlers** go in `src/webhook-handlers/` — never inline in the server.
- **Database queries** go through `src/database.js` helpers, never raw `fetch` to Supabase URLs.
- **Supabase schema changes** require a new numbered migration file in `supabase/migrations/` — never alter existing migration files.
- **Environment secrets** must never appear in committed code. Use `.env` locally and Vercel environment variables in production.

---

## Security Notes

- Stripe webhook signatures must be verified using `STRIPE_WEBHOOK_SECRET_01` before processing any webhook payload.
- Rate limiting is applied via `express-rate-limit`. Do not remove it.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses Row-Level Security (RLS) — use it only in server-side code, never expose it to the browser.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is safe for browser use; it is governed by RLS policies.

---

## Common Pitfalls

1. **Next.js vs Express confusion**: The project runs both. Next.js handles the frontend/pages; Express (`src/server.js`) runs the backend API on port 3005. They operate on different ports.
2. **TypeScript errors now surface in build**: Suppressions have been removed. Run `npx tsc --noEmit` to check types explicitly before building.
3. **Migration ordering**: SQL migrations must be applied in filename order. Gaps or out-of-order application will break the schema.
4. **Node version**: The engine field requires Node ≥ 20. Using an older Node version will cause subtle failures.
5. **Root-level scripts**: The repository root contains many one-off `.js`/`.ps1`/`.sql` diagnostic scripts from historical debugging sessions. These are not part of the running system. Active scripts live in `scripts/`.
