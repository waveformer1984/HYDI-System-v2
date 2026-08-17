# CASCADE v1

The canonical event processor for the HYDI RAW EVENT LEDGER.

## Purpose

CASCADE reads the immutable RAW EVENT LEDGER, validates each event, verifies fingerprints and hashes, normalizes payloads, derives a typed event store, and maintains a lineage graph. Future systems (KILO, Proto YI, Forge Finder, Build a Mind) consume CASCADE rather than reading the raw ledger directly.

## Commands

```bash
npm install
npm test
npm start
```

Default port: `4001`.

## Environment

```env
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...
PORT=4001
LEDGER_TABLE=raw_event_ledger
PROCESSOR_VERSION=1.0
DATA_DIR=./data
```

## API

- `GET /health` — public health status
- `GET /diagnostics` — metrics and event count
- `POST /replay` — replay and process events
- `GET /events` — list derived events
- `GET /events/:id` — get one derived event
- `GET /lineage/:fingerprint` — ancestors and descendants
- `GET /metrics` — metrics snapshot

## Architecture

```text
RAW EVENT LEDGER
      |
      v
LedgerAdapter
      |
      v
ReplayEngine
      |
      v
EventProcessor
      |
      v
DerivedStore + LineageGraph
      |
      v
Consumers (KILO, Proto YI, ...)
```

See `docs/` for full architecture.
