# SignalDesk architecture

SignalDesk lives at `apps/signaldesk` inside HYDI-System-v2 as a **separate product**. It does not participate in the HYDI CASCADE → KILO → ProtoForge event pipeline.

## Layers

| Layer | Responsibility | Stage |
|-------|----------------|-------|
| Browser UI | Next.js App Router, Tailwind, accessible components | 1+ |
| Authenticated API | Route handlers, Auth.js session | 1+ |
| Workspace authorization | `requireMembership` — never trust client workspace id | 1+ |
| PostgreSQL | Migrations, Drizzle types, RLS session vars (defense in depth) | 1+ |
| Redis + BullMQ | Research queue (stub in Stage 1) | 1 / 4 |
| Provider adapters | Demo, CSV, licensed APIs | 2–4 |
| Website observation | SSRF-safe fetcher | 4 |
| Local AI adapter | Ollama on private network | 5 |
| Billing adapter | Stripe Checkout + webhooks | 3 |
| Email adapter | Disabled in MVP | 5+ |

## Subscriptions (central config)

Plans are rows in `plans`; Stripe **price IDs** come from environment keys listed in `stripe_price_id_env_key`. Checkout must never accept client-supplied prices.

## Research credits

Reserved atomically in `research_credit_reservations` + `usage_ledger` (implementation Stage 3–4). One credit = one completed research run per business.

## Security notes

- Workers do not get billing admin tools.  
- Fetched HTML and CSV cells are untrusted input for AI and rendering.  
- Ollama is server-side only; no public exposure.

## Local development

```bash
docker compose -f apps/signaldesk/docker-compose.yml up -d
cp apps/signaldesk/.env.example apps/signaldesk/.env.local
# set AUTH_SECRET
cd apps/signaldesk && npm ci && npm run db:migrate && npm run dev
```

Optional worker: `npm run worker:dev` (requires Redis).