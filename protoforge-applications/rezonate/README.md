# Resonate ProtoForge Application

A ProtoForge-native wrapper around the existing `rezonate/` audio engine.

## Purpose

Resonate is the first ProtoForge application that organizes an existing, working system instead of rebuilding it. The existing Python audio pipeline remains the source of truth for generation, stem separation, and analysis. This application provides:

- project, track, and asset orchestration
- processing job lifecycle
- audio asset intelligence
- sample library adapter
- DAW export foundation
- validation and error boundaries
- domain events
- diagnostics
- health endpoints

## End-to-end flow

```text
User
 |
Ursula Studio
 |
ProtoForge Resonate (http://localhost:3001)
 |
Rezonate Engine
 |
Audio Asset
 |
Ownership Layer
 |
Future HYDI Ledger
```

## Architecture

```text
Existing Resonate Engine
          |
          v
   Resonate Engine Adapter
          |
          v
ProtoForge Resonate
          |
    +-----+------+-------+
    |            |       |
 Processing   Assets   Ownership
    |            |
    v            |
 DAW Export     Rights
    |            |
    v            v
 Ownership Layer (future)
```

## Relationship to existing systems

- `rezonate/` — owned by the audio engine; the adapter calls it.
- `supabase/migrations/20260522000001_rezonate_schema.sql` — schema baseline; the local repository mirrors it.
- `apps/ursula-frontend/...` and `pages/song-composer.tsx` — legacy/experimental frontends; now Ursula Resonate Studio connects to this API.

## Processing lifecycle

```text
queued
  ↓
generating
  ↓
stems_processing
  ↓
analyzing
  ↓
completed

or any → failed
```

Every transition emits a domain event.

## Generation workflow

```bash
POST /processing/jobs
{ "task_type": "generate", "prompt": "...", "clip": false }

POST /processing/jobs/:id/start
# invokes rezonate/generate.py, creates AudioAsset, emits audio.asset.created

GET /assets/:id/file
# streams the generated MP3
```

## Domain events

See `docs/domain-events.md`.

## Sample library

`src/adapters/sample-library.js` connects to `rezonate/samples-catalog.json` without copying it. Supports search by name/tag, filter by instrument, BPM range, and key.

## Export

`src/export/packaging.js` packages project assets with a JSON manifest and WAV stem bundle.

## Development commands

```bash
npm install
npm test
npm start
```

The server runs on `http://localhost:3001` by default.

## Status

First end-to-end ProtoForge application organism. 72/72 tests passing.
