# HYDI Event Gateway

Shared infrastructure service for ProtoForge application domain events.

## Quick start

```bash
set HYDI_SERVICE_KEY=your-secret-here
set SUPABASE_URL=https://...
set SUPABASE_SERVICE_ROLE_KEY=...
npm start
```

## Test

```bash
npm test
```

## API

- `GET /health` — public health status
- `POST /events` — authenticated event ingestion
- `GET /events` — authenticated event query/replay
- `GET /events/:fingerprint` — authenticated single event lookup

The gateway commits to the canonical HYDI RAW EVENT LEDGER (`lib/protoforge/raw-ledger.ts`).

See `docs/HYDI_EVENT_GATEWAY.md` for full architecture.
