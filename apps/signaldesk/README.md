# SignalDesk

Subscription SaaS for agencies: discover businesses, cite evidence, manage leads, prepare human-reviewed outreach.

**Tagline:** Find the right businesses. Show the evidence. Win the next conversation.

## Quick start (clean checkout)

```bash
# From repo root
docker compose -f apps/signaldesk/docker-compose.yml up -d

cd apps/signaldesk
cp .env.example .env.local
# Edit .env.local — minimum: AUTH_SECRET (openssl rand -base64 32)
# DATABASE_URL and REDIS_URL match docker-compose defaults

npm ci
npm run db:migrate
npm run dev          # http://127.0.0.1:3600
npm run worker:dev   # optional queue health
```

## Verification

```bash
npm run typecheck
npm test             # set DATABASE_URL for integration test
npm run build
```

## Modes

| `SIGNALDESK_MODE` | Meaning |
|-------------------|---------|
| `test` (default) | Stripe test intent; no live email |
| `demo` | Fictional sample data emphasis |
| `live` | Owner-approved production (not default) |

See [BUILD_STATUS.md](./BUILD_STATUS.md) for stage progress and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for layer boundaries.