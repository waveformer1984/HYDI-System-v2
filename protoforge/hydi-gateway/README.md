# HYDI Event Gateway

Shared infrastructure service for ProtoForge application domain events.

## Quick start

```bash
set HYDI_SERVICE_KEY=your-secret-here
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
- `GET /events/:id` — authenticated single event lookup

See `docs/HYDI_EVENT_GATEWAY.md` for full architecture.
