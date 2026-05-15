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
| Backend | Node.js ≥ 20, Express |
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
│   ├── server.js            # Main Express server (primary entry point)
│   ├── server-clean.js      # Minimal server variant
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
├── pages/                   # Next.js page routes (App Router not used)
├── components/              # React UI components
├── public/                  # Static assets
│
├── kilo.js                  # Kilo execution engine (Cascade bridge)
├── kilo/                    # Built-in Kilo modules
├── modules/                 # Custom modules directory
│
├── supabase/
│   ├── config.toml          # Supabase local dev config
│   ├── migrations/          # SQL migration files (run in order)
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
├── next.config.js           # Next.js config (TS & ESLint errors suppressed in build)
├── jest.config.js           # Jest config
├── tailwind.config.js       # Tailwind CSS config
├── package.json             # npm scripts & dependencies
└── .env.example             # Environment variable template
```

---

## Development Workflow

### Setup

```bash
npm install
cp .env.example .env   # fill in real values
```

### Run modes

```bash
npm run dev      # Next.js dev server (port 3000, hot-reload)
npm start        # next start (production mode)
node src/server.js  # Express API server directly
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
npm run build   # next build
npm run lint    # next lint
```

> **Note:** `next.config.js` silently suppresses TypeScript build errors (`ignoreBuildErrors: true`) and ESLint errors (`ignoreDuringBuilds: true`). Do not rely on these suppressions — fix errors at source.

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

### `src/server.js` — Express API Server
The full-featured Express server. Hosts the revenue endpoints and webhook processors. This is the primary runtime when running outside Next.js.

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

---

## CI/CD

- **Unit Tests**: `.github/workflows/unit-tests.yml` — runs `npm test` on push/PR.
- **CodeQL**: `.github/workflows/codeql.yml` — static security analysis.
- **Codecov**: Coverage reports uploaded from the `clean-main` branch.
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

1. **Next.js vs Express confusion**: The project runs both. Next.js handles the frontend/pages; Express (`src/server.js`) runs the backend API. They operate on different ports.
2. **TypeScript errors silenced at build**: The build succeeds even with TS errors. Run `npx tsc --noEmit` to check types explicitly.
3. **Migration ordering**: SQL migrations must be applied in filename order. Gaps or out-of-order application will break the schema.
4. **Node version**: The engine field requires Node ≥ 20. Using an older Node version will cause subtle failures.
