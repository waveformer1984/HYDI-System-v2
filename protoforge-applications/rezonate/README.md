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
    +-----+------+
    |            |
 Processing   Assets
    |
    v
 DAW Export

Ownership Layer:
NEXT PHASE
```

## Relationship to existing systems

- `rezonate/` — owned by the audio engine; the adapter calls it.
- `supabase/migrations/20260522000001_rezonate_schema.sql` — schema baseline; the local repository mirrors it.
- `apps/ursula-frontend/...` and `pages/song-composer.tsx` — legacy/experimental frontends; not merged.

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

failure path: failed
```

Every transition emits a domain event.

## Domain events

- `processing.job.created`
- `processing.started`
- `stems.processing.started`
- `analysis.started`
- `stems.completed`
- `analysis.completed`
- `processing.completed`
- `processing.failed`
- `audio.asset.created`
- `audio.asset.updated`
- `ownership.status_changed`
- `project.created`
- `track.created`

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

## Status

Canonical ProtoForge Resonate foundation with production pipeline layer.
